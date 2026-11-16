const mode = process.argv[2]
if (mode === 'wait') setTimeout(() => {}, 10000)
else { process.stdout.write('actual stdout\n'); process.stderr.write('actual stderr\n'); process.exitCode = mode === 'fail' ? 7 : 0 }
