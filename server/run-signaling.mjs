import { createServer } from 'node:http';
import { attachSignaling } from './signaling.mjs';

const server = createServer((_, res) => { res.writeHead(404).end(); });
attachSignaling(server);
server.listen(Number(process.env.PORT ?? 5300), () => {
  console.log('Tennis signaling listening on', server.address().port);
});
