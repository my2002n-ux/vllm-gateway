import './style.css';
import { createJsonToolPage } from './pages/JsonTool.js';
import { createLlmToolPage } from './pages/LlmTool.js';
import { createVectorToolPage } from './pages/VectorTool.js';

const app = document.querySelector('#app');
const path = window.location.pathname || '/';

if (path.startsWith('/llm')) {
  app.appendChild(createLlmToolPage());
} else if (path.startsWith('/vector')) {
  app.appendChild(createVectorToolPage());
} else {
  app.appendChild(createJsonToolPage());
}
