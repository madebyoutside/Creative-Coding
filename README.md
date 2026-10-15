# Creative Coding

A collection of creative coding sketches (p5.js and plain canvas), built with [Vite](https://vite.dev/) and published to GitHub Pages.

**Live site:** https://madebyoutside.github.io/Creative-Coding/

---

## Install

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/madebyoutside/Creative-Coding.git
cd Creative-Coding
npm install
```

`npm install` downloads Vite and p5.js into `node_modules/`. That folder is in `.gitignore` and never gets committed.

## Run locally

```bash
npm run dev
```

Then open **http://localhost:5173/Creative-Coding/**. Include `/Creative-Coding/` in the address, because `http://localhost:5173/` on its own shows a blank page.

- The page reloads automatically when you save a file.
- Restart `npm run dev` after adding a new sketch folder, so the home page picks it up.
- Stop the server with **Ctrl+C**.

## Project structure

```
Creative-Coding/
├── index.html              Home page: lists every sketch automatically
├── folder/                 One subfolder per sketch
│   └── animation-cross-fade-melt-effect/   p5.js photo-melt animation
│       ├── index.html
│       └── sketch.js
├── src/
│   ├── main.js             Home page script
│   ├── style.css           Home page styles
│   └── assets/             Images and other files, one subfolder per sketch
│       └── animation-cross-fade-melt-effect/
├── public/                 Files copied to the site as-is (e.g. favicon)
├── vite.config.js          Vite setup: base path + automatic sketch discovery
└── .github/workflows/
    └── deploy.yml          Builds and publishes to GitHub Pages on every push
```

## Adding a new p5.js sketch

1. **Create a folder** inside `folder/`, e.g. `folder/flow-field/`.

2. **Add `index.html`.** Copy one from an existing sketch. The only line that matters is the script tag:

   ```html
   <script type="module" src="./sketch.js"></script>
   ```

   Don't add a `<script src="p5.min.js">` tag. p5 comes from npm.

3. **Add `sketch.js`.** Write your sketch as usual, then add these lines to the top and the bottom:

   ```js
   import p5 from 'p5';

   // …your setup(), draw(), etc.

   Object.assign(window, { setup, draw });
   new p5();
   ```

   Every p5 function you define (`preload`, `windowResized`, `mousePressed`, …) must be listed in `Object.assign(window, { … })`, otherwise p5 won't call it.

4. **Restart `npm run dev`.** The sketch appears on the home page, at `/Creative-Coding/folder/flow-field/`.

You don't need to edit `vite.config.js`. Every `folder/<name>/index.html` is picked up automatically.

## Using images and other files

Put a sketch's files in `src/assets/<sketch-name>/` and **import** them:

```js
import photo1 from '/src/assets/flow-field/photo-1.webp';

let img;
function preload() {
  img = loadImage(photo1);
}
```

> ⚠️ Don't load files with a plain path such as `loadImage('photos/photo-1.webp')`. It works in `npm run dev` but **breaks on the live site**, because Vite only includes files you import in the build.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (once, or after `package.json` changes) |
| `npm run dev` | Local dev server with live reload |
| `npm run build` | Build the site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
