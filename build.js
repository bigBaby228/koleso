/*
 * Сборка одного файла dist/koleso.html: стили и скрипты встраиваются внутрь.
 * Нужна для быстрого предпросмотра и чтобы отправить игру одним файлом.
 * Для хостинга (GitHub Pages и т.п.) сборка не нужна, достаточно выложить папку как есть.
 * Запуск: node build.js
 */
const fs = require('fs'), path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + '\n</style>');
html = html.replace(/<script src="([a-z]+\.js)"><\/script>/g, (m, f) => '<script>\n' + fs.readFileSync(path.join(root, f), 'utf8') + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'koleso.html'), html);
console.log('Готово: dist/koleso.html (' + Math.round(html.length / 1024) + ' КБ)');
