import QtQuick
import Quickshell.Io

Item {
  id: root
  visible: false

  function request(command, callback) {
    var process = curlProcess.createObject(root,{command:command, completion:callback})
    if (!process) { callback(-1,""); return {abort:function() {}} }
    process.running = true
    return {abort:function() {
      process.completion = null
      if (process.running) process.running = false
      else process.destroy()
    }}
  }

  Component {
    id: curlProcess

    Process {
      id: curl
      property var completion: null
      property string capturedOutput: ""
      property bool outputFinished: false
      property bool processFinished: false
      property bool settled: false
      property int resultCode: -1

      stdout: StdioCollector {
        waitForEnd: true
        onStreamFinished: {
          curl.capturedOutput = String(text || "")
          curl.outputFinished = true
          curl.settle()
        }
      }
      stderr: StdioCollector { waitForEnd: true }

      function settle() {
        if (settled || !processFinished || !outputFinished) return
        settled = true
        var callback = completion
        completion = null
        if (callback) callback(resultCode,capturedOutput)
        destroy()
      }

      onExited: function(exitCode) {
        resultCode = exitCode
        processFinished = true
        settle()
      }
    }
  }
}
