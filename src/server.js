import { config } from './config.js';
import { createApplication } from './http-api.js';
import { createLiveRuntime } from './live-runtime.js';
const app = createApplication({ liveRuntime: createLiveRuntime() });
app.server.listen(config.port, '127.0.0.1', () => console.log('Agent Admission: http://127.0.0.1:' + config.port + ' [' + config.executionMode + ']'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  app.abortAll(); app.server.close(() => {
    const drain = setInterval(() => { if (!app.running.size) { clearInterval(drain); app.store.close(); process.exit(0); } }, 50);
  });
});

