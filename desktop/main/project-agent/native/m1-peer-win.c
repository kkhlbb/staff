#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static BOOL process_sid(HANDLE process, PSID sid) {
    HANDLE token;
    union { TOKEN_USER user; BYTE bytes[sizeof(TOKEN_USER) + SECURITY_MAX_SID_SIZE]; } info;
    DWORD size;
    if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return FALSE;
    BOOL ok = GetTokenInformation(token, TokenUser, &info, sizeof(info), &size)
        && CopySid(SECURITY_MAX_SID_SIZE, sid, info.user.User.Sid);
    CloseHandle(token);
    return ok;
}

static BOOL private_pipe(HANDLE pipe, PSID sid) {
    PSID owner;
    PACL dacl;
    PSECURITY_DESCRIPTOR descriptor;
    if (GetSecurityInfo(pipe, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &owner, NULL, &dacl, NULL, &descriptor) != ERROR_SUCCESS) return FALSE;
    ACCESS_ALLOWED_ACE *ace;
    BOOL ok = owner && EqualSid(owner, sid) && dacl && dacl->AceCount == 1
        && GetAce(dacl, 0, (void **)&ace) && ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE
        && ace->Header.AceFlags == 0 && EqualSid(&ace->SidStart, sid);
    LocalFree(descriptor);
    return ok;
}

static BOOL same_peer(HANDLE pipe, BOOL server, PSID sid) {
    ULONG pid;
    if (!(server ? GetNamedPipeClientProcessId(pipe, &pid) : GetNamedPipeServerProcessId(pipe, &pid))) return FALSE;
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return FALSE;
    BYTE peer[SECURITY_MAX_SID_SIZE];
    BOOL ok = process_sid(process, peer) && EqualSid(peer, sid);
    CloseHandle(process);
    return ok;
}

static void status(const char *message) {
    fputs(message, stderr);
    fputc('\n', stderr);
    fflush(stderr);
}

static HANDLE listen_pipe(const wchar_t *name, BOOL first, PSID sid) {
    LPWSTR sid_text;
    if (!ConvertSidToStringSidW(sid, &sid_text)) return INVALID_HANDLE_VALUE;
    wchar_t sddl[512];
    swprintf(sddl, sizeof(sddl) / sizeof(*sddl), L"O:%lsD:P(A;;GA;;;%ls)", sid_text, sid_text);
    LocalFree(sid_text);
    PSECURITY_DESCRIPTOR descriptor;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL))
        return INVALID_HANDLE_VALUE;
    SECURITY_ATTRIBUTES security = { sizeof(security), descriptor, FALSE };
    HANDLE pipe = CreateNamedPipeW(name, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | (first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0),
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, PIPE_UNLIMITED_INSTANCES, 65536, 65536, 0, &security);
    DWORD error = GetLastError();
    LocalFree(descriptor);
    if (pipe == INVALID_HANDLE_VALUE) SetLastError(error);
    return pipe;
}

static BOOL connect_pipe(HANDLE pipe) {
    OVERLAPPED io = { .hEvent = CreateEventW(NULL, TRUE, FALSE, NULL) };
    if (!io.hEvent) return FALSE;
    BOOL ok = ConnectNamedPipe(pipe, &io);
    if (!ok) {
        DWORD error = GetLastError(), ignored;
        ok = error == ERROR_PIPE_CONNECTED ||
            (error == ERROR_IO_PENDING && GetOverlappedResult(pipe, &io, &ignored, TRUE));
    }
    CloseHandle(io.hEvent);
    return ok;
}

static BOOL transfer(HANDLE handle, BOOL write, BYTE *buffer, DWORD length, DWORD *count, OVERLAPPED *io) {
    if (io) ResetEvent(io->hEvent);
    BOOL ok = write ? WriteFile(handle, buffer, length, count, io) : ReadFile(handle, buffer, length, count, io);
    if (ok || !io || GetLastError() != ERROR_IO_PENDING) return ok;
    return GetOverlappedResult(handle, io, count, TRUE);
}

struct relay { HANDLE input, output; BOOL pipe_is_input; };
static DWORD WINAPI copy_stream(void *data) {
    struct relay *relay = data;
    BYTE buffer[16384];
    OVERLAPPED io = { .hEvent = CreateEventW(NULL, TRUE, FALSE, NULL) };
    if (!io.hEvent) return 1;
    DWORD count;
    while (transfer(relay->input, FALSE, buffer, sizeof(buffer), &count, relay->pipe_is_input ? &io : NULL) && count) {
        for (DWORD offset = 0; offset < count;) {
            DWORD written;
            if (!transfer(relay->output, TRUE, buffer + offset, count - offset, &written,
                relay->pipe_is_input ? NULL : &io) || !written) {
                CloseHandle(io.hEvent);
                return 1;
            }
            offset += written;
        }
    }
    CloseHandle(io.hEvent);
    return 0;
}

static int launch_bridge(void) {
    wchar_t module[32768], executable[32768], bridge[32768], command[32768];
    DWORD length = GetModuleFileNameW(NULL, module, sizeof(module) / sizeof(*module));
    if (!length || length >= sizeof(module) / sizeof(*module)) return 1;
    wchar_t *base = wcsrchr(module, L'\\');
    if (!base) return 1;
    *base = L'\0';
    if (swprintf(executable, sizeof(executable) / sizeof(*executable), L"%ls\\..\\..\\\u5bf8\u94fe.exe", module) < 0 ||
        swprintf(bridge, sizeof(bridge) / sizeof(*bridge), L"%ls\\local-bridge.mjs", module) < 0 ||
        swprintf(command, sizeof(command) / sizeof(*command), L"\"%ls\" \"%ls\" \"%ls\"", executable, bridge, executable) < 0)
        return 1;
    STARTUPINFOW startup = { .cb = sizeof(startup), .dwFlags = STARTF_USESTDHANDLES,
        .hStdInput = GetStdHandle(STD_INPUT_HANDLE), .hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE),
        .hStdError = GetStdHandle(STD_ERROR_HANDLE) };
    PROCESS_INFORMATION process;
    if (!CreateProcessW(executable, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process)) return 1;
    CloseHandle(process.hThread);
    DWORD code = 1;
    if (WaitForSingleObject(process.hProcess, INFINITE) == WAIT_OBJECT_0) GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hProcess);
    return (int)code;
}

static DWORD WINAPI watch_parent(void *process) {
    WaitForSingleObject(process, INFINITE);
    ExitProcess(1);
}

int wmain(int argc, wchar_t **argv) {
    if (argc == 2 && wcscmp(argv[1], L"launch") == 0) return launch_bridge();
    BYTE sid[SECURITY_MAX_SID_SIZE];
    if (!process_sid(GetCurrentProcess(), sid)) return 1;
    if (argc == 2 && wcscmp(argv[1], L"sid") == 0) {
        LPSTR value;
        if (!ConvertSidToStringSidA(sid, &value)) return 1;
        puts(value);
        LocalFree(value);
        return 0;
    }
    if (argc != 4 || wcsncmp(argv[2], L"\\\\.\\pipe\\cunlian-m1-", 20) != 0) return 1;
    BOOL first = wcscmp(argv[1], L"listen-first") == 0;
    BOOL server = first || wcscmp(argv[1], L"listen") == 0;
    if (!server && wcscmp(argv[1], L"connect") != 0) return 1;
    wchar_t *end;
    DWORD parent_pid = wcstoul(argv[3], &end, 10);
    if (!parent_pid || *end) return 1;
    HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
    if (!parent) return 1;
    HANDLE watchdog = CreateThread(NULL, 0, watch_parent, parent, 0, NULL);
    if (!watchdog) return 1;
    CloseHandle(watchdog);
    HANDLE pipe = server ? listen_pipe(argv[2], first, sid) :
        CreateFileW(argv[2], FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE,
            0, NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, NULL);
    if (pipe == INVALID_HANDLE_VALUE) {
        DWORD error = GetLastError();
        status(error == ERROR_FILE_NOT_FOUND ? "MISSING" : error == ERROR_PIPE_BUSY ? "BUSY" : "UNTRUSTED");
        return 1;
    }
    if (!private_pipe(pipe, sid)) {
        status("UNTRUSTED");
        CloseHandle(pipe);
        return 1;
    }
    if (server) {
        status("READY");
        if (!connect_pipe(pipe)) {
            status("RETRY");
            CloseHandle(pipe);
            return 1;
        }
    }
    if (!same_peer(pipe, server, sid)) {
        status(server ? "RETRY" : "UNTRUSTED");
        CloseHandle(pipe);
        return 1;
    }
    struct relay upstream = { GetStdHandle(STD_INPUT_HANDLE), pipe, FALSE };
    struct relay downstream = { pipe, GetStdHandle(STD_OUTPUT_HANDLE), TRUE };
    status("CONNECTED");
    HANDLE threads[] = { CreateThread(NULL, 0, copy_stream, &upstream, 0, NULL),
        CreateThread(NULL, 0, copy_stream, &downstream, 0, NULL) };
    if (threads[0] && threads[1]) WaitForMultipleObjects(2, threads, FALSE, INFINITE);
    // Exit the process to close both directions, including a thread blocked on synchronous I/O.
    ExitProcess(0);
}
