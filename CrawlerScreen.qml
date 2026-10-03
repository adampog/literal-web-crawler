import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "core/crawler.js" as Core
import "core/screen-map.js" as ScreenMap

// One monitor's worth of crawling: the frozen screenshot, the holes torn in
// it, the pieces flying off, and the spider drawn on a canvas on top.
PanelWindow {
  id: win

  // The Crawler.qml root: shared settings, dismiss() and repairGeneration.
  required property var host
  required property string shotPath
  property bool focused: false
  readonly property string shotUrl: "file://" + shotPath

  property var map: null // footholds and chunks from core/screen-map.js
  property var spider: null // the engine from core/crawler.js
  property var holeItems: []
  property int seenRepair: host.repairGeneration
  // First pointer position seen in screensaver mode; moving away from it wakes up.
  property point wakeOrigin: Qt.point(-1, -1)
  property bool hudVisible: !host.screensaver && focused

  anchors { top: true; left: true; right: true; bottom: true }
  color: Color.background
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "literal-web-crawler"
  WlrLayershell.keyboardFocus: focused ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  // Spider colors: theme ink and fill, neon legs, theme accent for the glow.
  readonly property var theme: ({
    ink: String(Color.foreground),
    fill: String(Color.background),
    accent: String(Color.accent),
    eyes: Core.CRAWLER_PALETTE[0],
    legs: Core.CRAWLER_PALETTE
  })

  // The engine's view of this screen (see the host contract in core/crawler.js).
  function makeHost() {
    return {
      footholdNear: function(x, y, r) {
        return win.map ? ScreenMap.screenFoothold(win.map, x, y, r) : null
      },
      tearOff: function(chunk) {
        chunk.gone = true
        var glow = Core.CRAWLER_PALETTE[win.spider.torn % Core.CRAWLER_PALETTE.length]
        win.holeItems.push(holeComponent.createObject(holes, {
          x: chunk.x, y: chunk.y, width: chunk.w, height: chunk.h, glow: glow
        }))
        var visual = pieceComponent.createObject(pieces, {
          x: chunk.x, y: chunk.y, source: Qt.rect(chunk.x, chunk.y, chunk.w, chunk.h), glow: glow
        })
        return { x: chunk.x, y: chunk.y, w: chunk.w, h: chunk.h, visual: visual }
      },
      bounds: function() {
        return { left: 0, top: 0, right: win.width, bottom: win.height }
      },
      removePiece: function(p) {
        if (p.visual) p.visual.destroy()
      }
    }
  }

  // Read the screenshot's pixels (downscaled) and build the foothold map, then
  // drop the spider in the middle of the screen.
  function analyse() {
    var ctx = probe.getContext("2d")
    ctx.drawImage(win.shotUrl, 0, 0, probe.width, probe.height)
    var data = ctx.getImageData(0, 0, probe.width, probe.height)
    win.map = ScreenMap.buildScreenMap(data.data, probe.width, probe.height, win.width / probe.width)
    win.spider = Core.createCrawler(win.makeHost())
    win.spider.placeAt(win.width * 0.5, win.height * 0.5)
  }

  // Put back every torn piece on this screen.
  function repair() {
    for (var i = 0; i < win.holeItems.length; i++) win.holeItems[i].destroy()
    win.holeItems = []
    if (!win.spider) return
    for (var k = 0; k < win.spider.pieces.length; k++) {
      if (win.spider.pieces[k].visual) win.spider.pieces[k].visual.destroy()
    }
    win.spider.clearPieces()
    if (win.map) win.map.chunks = []
  }

  // Copy settings from the shared root and move the visuals to match the engine.
  function tick(dt) {
    if (win.seenRepair !== host.repairGeneration) {
      win.seenRepair = host.repairGeneration
      win.repair()
    }
    var s = win.spider
    s.size = host.size
    s.ripRate = host.ripRate
    s.mode = host.follow ? "follow" : "roam"
    if (!host.paused) s.step(Math.min(1 / 30, dt))
    for (var i = 0; i < s.pieces.length; i++) {
      var p = s.pieces[i]
      p.visual.x = p.x
      p.visual.y = p.y
      p.visual.rotation = p.rot * 180 / Math.PI
      p.visual.opacity = p.alpha
    }
    legs.requestPaint()
  }

  // Analysis canvas: a third of the screen's size, hidden behind the screenshot.
  Canvas {
    id: probe
    width: Math.max(1, Math.round(win.width / 3))
    height: Math.max(1, Math.round(win.height / 3))
    z: -1
    property bool requested: false

    function start() {
      if (requested || win.width < 2 || win.height < 2) return
      requested = true
      loadImage(win.shotUrl)
    }
    Component.onCompleted: start()
    onWidthChanged: start()
    onImageLoaded: requestPaint()
    onPaint: if (isImageLoaded(win.shotUrl) && !win.map) win.analyse()
  }

  Image {
    id: shot
    anchors.fill: parent
    source: win.shotUrl
    fillMode: Image.Stretch
    cache: false
    smooth: true
  }

  Item { id: holes; anchors.fill: parent }
  Item { id: pieces; anchors.fill: parent }

  Canvas {
    id: legs
    anchors.fill: parent
    renderTarget: Canvas.FramebufferObject
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (win.spider) Core.drawSpider(ctx, win.spider, win.theme)
    }
  }

  // A hole where a piece used to be: theme background with a neon rim.
  Component {
    id: holeComponent
    Rectangle {
      property color glow: "white"
      color: Color.background
      radius: 2
      border.width: 1
      border.color: Qt.rgba(glow.r, glow.g, glow.b, 0.7)
    }
  }

  // A torn piece: a frozen slice of the screenshot with a tint and a glowing edge.
  Component {
    id: pieceComponent
    Item {
      id: piece
      property rect source
      property color glow: "white"
      width: source.width
      height: source.height

      Rectangle {
        anchors.fill: parent
        anchors.margins: -3
        radius: 3
        color: "transparent"
        border.width: 2
        border.color: piece.glow
      }
      ShaderEffectSource {
        anchors.fill: parent
        sourceItem: shot
        sourceRect: piece.source
        live: false
      }
      Rectangle {
        anchors.fill: parent
        color: piece.glow
        opacity: 0.2
      }
    }
  }

  FrameAnimation {
    running: win.spider !== null
    onTriggered: win.tick(frameTime)
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.AllButtons

    onPositionChanged: function(mouse) {
      if (host.screensaver) {
        // The compositor sends a motion event when the surface appears; only
        // a real move away from that first point wakes the screen.
        if (win.wakeOrigin.x < 0) win.wakeOrigin = Qt.point(mouse.x, mouse.y)
        else if (Math.hypot(mouse.x - win.wakeOrigin.x, mouse.y - win.wakeOrigin.y) > 12) host.dismiss()
        return
      }
      if (win.spider) win.spider.setPointer(mouse.x, mouse.y)
    }
    onPressed: function(mouse) {
      if (host.screensaver) host.dismiss()
      else if (win.spider) win.spider.sendTo(mouse.x, mouse.y)
    }
  }

  // Keyboard controls (the focused monitor only).
  Item {
    anchors.fill: parent
    focus: win.focused

    Keys.onPressed: function(event) {
      event.accepted = true
      if (host.screensaver) {
        host.dismiss()
        return
      }
      switch (event.key) {
      case Qt.Key_Escape:
      case Qt.Key_Q:
        host.dismiss()
        break
      case Qt.Key_Space:
        host.paused = !host.paused
        break
      case Qt.Key_R:
        host.repairGeneration++
        break
      case Qt.Key_F:
        host.follow = !host.follow
        break
      case Qt.Key_Plus:
      case Qt.Key_Equal:
        host.size = Math.min(2.5, host.size + 0.1)
        break
      case Qt.Key_Minus:
        host.size = Math.max(0.5, host.size - 0.1)
        break
      case Qt.Key_BracketRight:
        host.ripRate = Math.min(1, host.ripRate + 0.1)
        break
      case Qt.Key_BracketLeft:
        host.ripRate = Math.max(0, host.ripRate - 0.1)
        break
      case Qt.Key_H:
        win.hudVisible = !win.hudVisible
        break
      default:
        event.accepted = false
      }
    }
  }

  // Key hints, bottom left of the focused screen. H hides them.
  Rectangle {
    visible: win.hudVisible
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    anchors.margins: 24
    width: hud.implicitWidth + 28
    height: hud.implicitHeight + 16
    radius: 8
    color: Qt.rgba(0, 0, 0, 0.62)
    border.width: 1
    border.color: Core.CRAWLER_PALETTE[1]

    Text {
      id: hud
      anchors.centerIn: parent
      textFormat: Text.StyledText
      color: "#d8dce2"
      font.family: "monospace"
      font.pixelSize: 13
      text: {
        var c = Core.CRAWLER_PALETTE
        var key = function(k, color) { return "<font color='" + color + "'>" + k + "</font>" }
        return key("Esc", c[1]) + " close   " + key("Space", c[0]) + (host.paused ? " resume   " : " pause   ")
          + key("R", c[2]) + " repair   " + key("F", c[3]) + (host.follow ? " roam   " : " follow mouse   ")
          + key("+/-", c[0]) + " size " + host.size.toFixed(1) + "   "
          + key("[ ]", c[1]) + " rip " + Math.round(host.ripRate * 100) + "%   "
          + key("H", c[2]) + " hide"
      }
    }
  }
}
