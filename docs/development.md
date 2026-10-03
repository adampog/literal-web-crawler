# Development

This is for working on the code. Using the plugin needs none of it: the
Omarchy plugin is plain QML and JavaScript, and nothing here runs on your
desktop.

## Checks

Node.js 22 or newer.

```bash
npm install
npm run check   # lint + manifest validation + tests
```

- `npm run lint`: ESLint over the engine, browser host, tests and scripts.
- `npm run validate`: the same manifest checks `omarchy plugin validate` does.
- `npm test`: engine and screen-map tests with Node's test runner.

CI runs the same three steps on every push.

## Browser version

Serve the folder (`npx serve .`) and open it. The page loads
`core/crawler.js` and `web/app.js` as separate files, so opening
`index.html` straight from disk will not work.

## QML

On an Omarchy machine, lint the plugin's QML:

```bash
qmllint -I "$OMARCHY_PATH/shell" *.qml
```

Saving a file in an installed plugin reloads it, but this plugin is
`keepLoaded`, so changes take effect after `omarchy-restart-shell`.
