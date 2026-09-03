// 迷你 mock 服务器：模拟 OpenAI 兼容 /v1/models 接口，用于冒烟测试
// 用法：node tools/mock-models.js [port]
const http = require('http');

const FAKE = [
  'glm-4.6',
  'kimi-k3-thinking',
  'deepseek-v4',
  'qwen3-max',
  'doubao-seed-2.0-pro',
  'gpt-5.5',
  'claude-opus-4.1',
];

const port = Number(process.argv[2]) || 9999;

http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: FAKE.map(id => ({ id, object: 'model', owned_by: 'mock' })),
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`MOCK listening on http://127.0.0.1:${port}/v1/models`);
});
