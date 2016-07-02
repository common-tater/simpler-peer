var SimplerPeer = require('./')
var tape = require('tape')

var p1 = null
var p2 = null

tape('connect', function (t) {
  t.plan(2)

  p1 = new SimplerPeer({ initiator: true })
  p2 = new SimplerPeer()

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    t.pass('p1 connected')
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
  })
})

tape('open a data channel and be able to send and receive binary data', function (t) {
  t.plan(6)

  p1.testChannel = p1.createDataChannel('test-channel')

  p1.testChannel.on('message', function (evt) {
    var data = evt.data
    t.equal(data instanceof ArrayBuffer, true)
    data = new Uint8Array(data)
    t.equal(data[0], 1)
    t.equal(data[1], 127)
    t.equal(data[2], 255)
  })

  p1.testChannel.send('wow')

  p2.on('datachannel', function (channel) {
    t.equal(channel.label, 'test-channel', 'p2 saw channel open')
    p2.testChannel = channel

    p2.testChannel.on('message', function (evt) {
      t.equal(evt.data, 'wow')
      var buffer = new ArrayBuffer(3)
      var view = new Uint8Array(buffer)
      view[0] = 1
      view[1] = 127
      view[2] = 255
      p2.testChannel.send(buffer)
    })
  })
})

tape('trigger a close event when closed', function (t) {
  t.plan(2)

  p1.on('close', function () {
    t.pass('p1 closed')
  })

  p2.on('close', function () {
    t.pass('p2 closed')
  })

  p1.close()
  p2.close()
})

tape('connect with trickle ice disabled', function (t) {
  t.plan(4)

  p1 = new SimplerPeer({ initiator: true, trickle: false })
  p2 = new SimplerPeer({ trickle: false })

  var p1DidSignal = false
  var p2DidSignal = false

  p1.on('signal', function (signal) {
    t.equal(p1DidSignal, false, 'p1 should only get one signal')
    p1DidSignal = true
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    t.equal(p2DidSignal, false, 'p2 should only get one signal')
    p2DidSignal = true
    p1.signal(signal)
  })

  p1.on('connect', function () {
    t.pass('p1 connected')
    onconnect()
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return
    p1.close()
    p2.close()
  }
})

tape('automatically handle session renegotiation when addStream is called', function (t) {
  t.plan(3)

  p1 = new SimplerPeer({ initiator: true })
  p2 = new SimplerPeer()

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    t.pass('p1 connected')
    onconnect()
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p2.on('stream', function (remoteStream) {
      t.ok(remoteStream)
      onaddStream()
    })

    var ctx = new AudioContext()
    var stream = ctx.createMediaStreamDestination().stream
    p1.addStream(stream)
  }

  function onaddStream () {
    p1.close()
    p2.close()
  }
})

tape('automatically handle session renegotiation when removeStream is called', function (t) {
  t.plan(4)

  p1 = new SimplerPeer({ initiator: true })
  p2 = new SimplerPeer()

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    t.pass('p1 connected')
    onconnect()
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p2.on('stream', function (remoteStream) {
      t.ok(remoteStream)
      remoteStream.onended = onstreamEnded
      p1.removeStream(stream)
    })

    var ctx = new AudioContext()
    var stream = ctx.createMediaStreamDestination().stream
    p1.addStream(stream)
  }

  function onstreamEnded () {
    t.pass()
    p1.close()
    p2.close()
  }
})

tape('automatically handle session renegotiation when addStream is called by both sides simultaneously', function (t) {
  t.plan(4)

  p1 = new SimplerPeer({ initiator: true })
  p2 = new SimplerPeer()

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    t.pass('p1 connected')
    onconnect()
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p1.on('stream', function (remoteStream) {
      t.ok(remoteStream)
      onaddStream()
    })

    p2.on('stream', function (remoteStream) {
      t.ok(remoteStream)
      onaddStream()
    })

    var ctx = new AudioContext()
    var stream1 = ctx.createMediaStreamDestination().stream
    p1.addStream(stream1)
    var stream2 = ctx.createMediaStreamDestination().stream
    p2.addStream(stream2)
  }

  var o = 2
  function onaddStream () {
    if (--o !== 0) return
    p1.close()
    p2.close()
  }
})

tape('only uses the latest of multiple offers during automatic session renegotiation', function (t) {
  t.plan(3)

  p1 = new SimplerPeer({ initiator: true })
  p2 = new SimplerPeer()

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    t.pass('p1 connected')
    onconnect()
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p1.on('stream', function (remoteStream) {
      t.ok(remoteStream)
      onaddStream()
    })

    p2.on('stream', function (remoteStream) {
      t.fail()
    })

    var ctx = new AudioContext()
    var stream1 = ctx.createMediaStreamDestination().stream
    p1.addStream(stream1)
    var stream2 = ctx.createMediaStreamDestination().stream
    p2.addStream(stream2)

    // this will cause p2 to get multiple offers
    // before setting localDescription
    p1.removeStream(stream1)
  }

  function onaddStream () {
    p1.close()
    p2.close()
  }
})
