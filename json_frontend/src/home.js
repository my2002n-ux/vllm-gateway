import './style.css';

const app = document.querySelector('#app');

const container = document.createElement('div');
container.className = 'home-page';

const hero = document.createElement('div');
hero.className = 'home-hero';
hero.innerHTML = '<h1>工具导航</h1><p>选择一个工具开始使用</p>';

const grid = document.createElement('div');
grid.className = 'home-grid';

const items = [
  { title: 'JSON 工具', desc: '解析、搜索、删除、导出', href: '/json/' },
  { title: '模型测试', desc: '本地大模型测试前端', href: '/llm/' },
  { title: '向量检索', desc: '本地向量检索测试', href: '/vector/' },
  { title: '图片生成测试（Z-image模型）', desc: 'Z-image 生图与历史管理', href: '/zimage/' },
];

items.forEach((item) => {
  const card = document.createElement('a');
  card.className = 'home-card';
  card.href = item.href;
  card.innerHTML = `<div class="home-card-title">${item.title}</div><div class="home-card-desc">${item.desc}</div>`;
  grid.appendChild(card);
});

container.appendChild(hero);
container.appendChild(grid);
app.appendChild(container);
