import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland

// Screensaver service for the Literal Web Crawler plugin.
//
// When you have been idle for as long as Omarchy's screensaver timeout, this
// summons the overlay in screensaver mode. It only takes over when Omarchy's
// built-in terminal screensaver is switched off (`omarchy-toggle-screensaver`),
// so the two never fight. Touching anything closes it again.
Item {
  id: root

  // Injected by the Omarchy shell host.
  property var shell: null
  property var manifest: null

  readonly property string pluginId: (manifest && manifest.id) || "io.github.adampog.literal-web-crawler"

  // Follow shell.json's idle.screensaver; 150 s is Omarchy's own default.
  readonly property int timeoutSeconds: {
    var seconds = shell && shell.idleConfig ? Number(shell.idleConfig.screensaver) : NaN
    return seconds > 0 ? seconds : 150
  }

  property bool showing: false

  IdleMonitor {
    id: idle
    enabled: true
    timeout: root.timeoutSeconds
    respectInhibitors: true // a playing video keeps the spider away

    onIsIdleChanged: {
      if (idle.isIdle) {
        gate.running = true
      } else if (root.showing) {
        root.showing = false
        if (root.shell) root.shell.hide(root.pluginId)
      }
    }
  }

  // Start only if the built-in screensaver is off, the spider screensaver has
  // not been opted out of, and the session is not locked.
  Process {
    id: gate
    command: ["bash", "-lc", [
      "state=$HOME/.local/state/omarchy/toggles",
      "[[ -f $state/screensaver-off ]] || exit 1",
      "[[ -f $state/literal-web-crawler-screensaver-off ]] && exit 1",
      "[[ $(omarchy-shell lock isLocked 2>/dev/null) == true ]] && exit 1",
      "exit 0"
    ].join("\n")]

    onExited: function(exitCode) {
      if (exitCode !== 0 || !idle.isIdle || !root.shell) return
      root.showing = true
      root.shell.summon(root.pluginId, JSON.stringify({ mode: "screensaver" }))
    }
  }
}
