import QtQuick
import QtQml.WorkerScript
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "core/article.js" as Article

// Overlay entry point for the Literal Web Crawler plugin.
//
// Opening it takes a screenshot of every monitor with grim, then shows one
// fullscreen CrawlerScreen per monitor on top of that frozen picture, with a
// spider walking across it. The overlay never touches your real windows: the
// spider tears pieces out of the screenshot only.
//
// Summoned two ways:
//   - a keybind runs `omarchy-shell shell toggle <id>`        -> interactive mode
//   - Service.qml summons it with {"mode":"screensaver"} on idle -> any input closes it
Item {
  id: root

  // Injected by the Omarchy shell host.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  readonly property string pluginId: (manifest && manifest.id) || "io.github.adampog.literal-web-crawler"

  // Omarchy 4.0.4 does not inject inline settings into overlay entry points.
  // Read only our entry; never write shell.json or retain unrelated settings.
  property string marking: "hourglass"

  function loadMarking(raw) {
    root.marking = "hourglass"
    try {
      var config = JSON.parse(raw || "")
      if (!config || config.version !== 1 || !Array.isArray(config.plugins)) return
      for (var i = 0; i < config.plugins.length; i++) {
        var entry = config.plugins[i]
        if (entry && entry.id === root.pluginId) {
          root.marking = entry.marking === "arch" ? "arch" : "hourglass"
          return
        }
      }
    } catch (error) { /* Missing or invalid settings keep the default. */ }
  }

  FileView {
    id: markingConfig
    path: Quickshell.env("HOME") + "/.config/omarchy/shell.json"
    watchChanges: true
    preload: true
    blockLoading: false
    blockAllReads: false
    printErrors: false
    onLoaded: root.loadMarking(markingConfig.text())
    onLoadFailed: root.loadMarking("")
    onFileChanged: markingConfig.reload()
  }

  // The host reads `opened`; the screens are only created while it is true.
  property bool opened: false
  property bool capturing: false
  property bool screensaver: false
  property bool searchMode: false
  property bool searchPrompt: false
  property bool searchBusy: false
  property string searchMessage: "Enter a Wikipedia article title."
  property string searchTerm: ""
  property var article: null
  property var articleClient: null
  property var timeoutCallback: null
  property var parseCallback: null
  property int parseId: 0

  ArticleTransport { id: articleTransport }

  function showSearch() {
    if (root.screensaver) return
    root.searchMode = true
    root.searchPrompt = true
  }

  function submitSearch(term) {
    if (!root.articleClient) {
      root.articleClient = Article.createArticleClient({
        request: function(command, callback) { return articleTransport.request(command,callback) },
        parse: function(body, callback) {
          root.parseId++
          root.parseCallback = callback
          articleWorker.sendMessage({id:root.parseId,body:body})
        },
        startTimer: function(callback) { root.timeoutCallback = callback; requestTimeout.restart() },
        stopTimer: function() { requestTimeout.stop(); root.timeoutCallback = null },
        changed: function(state) {
          root.searchBusy = state.busy
          root.searchMessage = state.message
          root.searchTerm = state.term
          root.article = state.article
          if (state.article && !state.busy && !state.message) root.searchPrompt = false
        }
      })
    }
    root.articleClient.search(term)
  }

  WorkerScript {
    id: articleWorker
    source: "core/article.js"
    onMessage: function(messageObject) {
      if (messageObject.id !== root.parseId || !root.parseCallback) return
      var callback = root.parseCallback
      root.parseCallback = null
      callback(messageObject.article, messageObject.message)
    }
  }

  Timer {
    id: requestTimeout
    interval: 12000
    onTriggered: {
      var callback = root.timeoutCallback
      if (callback) callback()
    }
  }

  // Screenshots go to a per-user tmpfs folder; each open gets a fresh stamp so
  // QML never shows a cached picture from the last run.
  readonly property string captureDir: Quickshell.env("XDG_RUNTIME_DIR") ? Quickshell.env("XDG_RUNTIME_DIR") + "/literal-web-crawler" : ""
  property string captureStamp: ""

  // Settings shared by every screen. The keyboard controls change these.
  property real size: 0.714
  property real ripRate: 0.35
  property bool paused: false
  property bool follow: false
  // Bumped to tell every screen to put its torn pieces back.
  property int repairGeneration: 0

  readonly property string focusedScreenName: Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""

  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) { payload = ({}) }
    if (!payload || typeof payload !== "object") payload = ({})
    if (root.opened || capture.running || cleanup.running) return
    root.screensaver = payload.mode === "screensaver"
    root.searchMode = payload.mode === "search"
    root.searchPrompt = root.searchMode
    root.article = null
    root.searchMessage = "Enter a Wikipedia article title."
    if (root.searchMode) {
      root.paused = false
      root.opened = true
      return
    }

    root.paused = false
    root.captureStamp = String(Date.now())
    var names = []
    for (var i = 0; i < Quickshell.screens.length; i++) names.push(Quickshell.screens[i].name)
    // Capture first, then show: the overlay must not be in its own screenshot.
    capture.command = ["bash", "-c", root.captureScript, "literal-web-crawler", root.captureDir, root.captureStamp].concat(names)
    root.capturing = true
    capture.running = true
  }

  function close() {
    root.capturing = false
    if (root.articleClient) root.articleClient.cancel()
    root.parseId++
    root.parseCallback = null
    root.opened = false
    if (!capture.running) cleanup.running = true
  }

  // Close from inside the overlay, and tell the host so its state matches.
  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function shotPath(screenName) {
    return root.captureDir + "/" + screenName + "-" + root.captureStamp + ".png"
  }

  // $1 = folder, $2 = stamp, then one output name per monitor.
  readonly property string captureScript: [
    "dir=$1; stamp=$2; shift 2",
    "test -n \"$dir\" || exit 1",
    "command -v grim >/dev/null || exit 127",
    "mkdir -p \"$dir\" && rm -f \"$dir\"/*.png",
    "for out in \"$@\"; do grim -o \"$out\" \"$dir/$out-$stamp.png\" || exit 1; done"
  ].join("\n")

  Process {
    id: capture
    onExited: function(exitCode) {
      // Let a canceled capture drain before cleanup or the next open.
      if (!root.capturing) { cleanup.running = true; return }
      root.capturing = false
      if (exitCode === 0) {
        root.opened = true
        return
      }
      var why = exitCode === 127 ? "Install grim to let the spider see your screen" : "Could not take a screenshot"
      Quickshell.execDetached([root.omarchyPath + "/bin/omarchy-notification-send", "Literal Web Crawler", why])
      if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
    }
  }

  Process {
    id: cleanup
    command: ["bash", "-c", "test -n \"$1\" && rm -f \"$1\"/*.png", "literal-web-crawler", root.captureDir]
  }

  // One window per monitor, created on open and destroyed on close.
  Variants {
    model: root.opened ? Quickshell.screens : []

    CrawlerScreen {
      required property var modelData

      screen: modelData
      host: root
      shotPath: root.shotPath(modelData.name)
      focused: modelData.name === root.focusedScreenName || Quickshell.screens.length === 1
    }
  }
}
