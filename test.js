var SimplerPeer = require('./')
var tape = require('tape')

var ctx = new AudioContext()
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

tape('handle session renegotiation when addTrack is called', function (t) {
  t.plan(1)

  p1 = new SimplerPeer({ initiator: true })
  p2 = new SimplerPeer()

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    onconnect()
  })

  p2.on('connect', function () {
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p2.on('track', function (evt) {
      t.ok(evt.track)
      onaddTrack()
    })

    var stream = ctx.createMediaStreamDestination().stream
    var sender = p1.addTrack(stream.getTracks()[0], stream)
  }

  function onaddTrack () {
    p1.close()
    p2.close()
  }
})

tape('handle session renegotiation when removeTrack is called', function (t) {
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
    onconnect()
  })

  p2.on('connect', function () {
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p2.on('track', function (evt) {
      t.ok(evt.track)
      evt.track.onended = ontrackEnded
      p1.removeTrack(sender)
    })

    var stream = ctx.createMediaStreamDestination().stream
    var sender = p1.addTrack(stream.getTracks()[0], stream)
  }

  function ontrackEnded () {
    t.pass()
    p1.close()
    p2.close()
  }
})

tape('handle session renegotiation when offers are received by both sides simultaneously', function (t) {
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
    onconnect()
  })

  p2.on('connect', function () {
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p1.on('track', function (evt) {
      t.ok(evt.track)
      onaddTrack()
    })

    p2.on('track', function (evt) {
      t.ok(evt.track)
      onaddTrack()
    })

    var stream1 = ctx.createMediaStreamDestination().stream
    var stream2 = ctx.createMediaStreamDestination().stream
    var sender1 = p1.addTrack(stream1.getTracks()[0], stream1)
    var sender2 = p2.addTrack(stream2.getTracks()[0], stream2)
  }

  var o = 2
  function onaddTrack () {
    if (--o !== 0) return
    p1.close()
    p2.close()
  }
})

tape('handle session renegotiation when offers are received by both sides simultaneously but the winning offer carries fewer than the required number of m-lines', function (t) {
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
    onconnect()
  })

  p2.on('connect', function () {
    onconnect()
  })

  var n = 2
  function onconnect () {
    if (--n !== 0) return

    p1.on('track', function (evt) {
      t.ok(evt.track)
      onaddTrack()
    })

    // force p1's offer to always win
    p1._compareOffers = function (a, b) { return true }
    p2._compareOffers = function (a, b) { return false }

    // manually force p1 to renegotiate
    p1._onNegotiationNeeded()

    // actually add a stream from p2
    var stream = ctx.createMediaStreamDestination().stream
    var sender = p2.addTrack(stream.getTracks()[0], stream)
  }

  function onaddTrack () {
    t.pass()
    p1.close()
    p2.close()
  }
})
