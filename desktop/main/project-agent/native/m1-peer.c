/* fd 3 is inherited directly from the trusted Node parent. */
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
    if (argc != 2) return 2;
    if (strcmp(argv[1], "lock") == 0)
        return flock(3, LOCK_EX | LOCK_NB) == 0 ? 0 : 1;
    if (strcmp(argv[1], "peer") == 0) {
        uid_t uid;
        gid_t gid;
        return getpeereid(3, &uid, &gid) == 0 && uid == geteuid() ? 0 : 1;
    }
    return 2;
}
