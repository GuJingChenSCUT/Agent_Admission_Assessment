import { config } from './config.js';
import { createApplication } from './http-api.js';
const app = createApplication();
app.server.listen(config.port, '127.0.0.1', () => console.log('Agent Admission: http://127.0.0.1:' + config.port + ' [' + config.executionMode + ']'));

