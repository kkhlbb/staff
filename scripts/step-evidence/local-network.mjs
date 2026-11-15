import net from 'node:net'
import assert from 'node:assert/strict'
const denied=process.argv[2]==='denied'
const server=net.createServer()
server.once('error',error=>{assert.equal(denied,true);assert.ok(['EPERM','EACCES'].includes(error.code));console.log('Network restriction effective: '+error.code)})
server.listen(0,'127.0.0.1',()=>{assert.equal(denied,false);console.log('Control network listener available: '+JSON.stringify(server.address()));server.close()})
