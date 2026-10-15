import './style.css'

// __SKETCHES__ is filled in by vite.config.js from the folders inside folder/
const links = __SKETCHES__
  .map((name) => `<li><a href="${import.meta.env.BASE_URL}folder/${name}/">${name}</a></li>`)
  .join('')

document.querySelector('#app').innerHTML = `
  <h1>Creative Coding</h1>
  <ul>${links}</ul>
`
