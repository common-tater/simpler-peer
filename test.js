var tape = require('tape')
var Peer = require('./')

var ctx = new window.AudioContext()
var p1 = null
var p2 = null

tape('not connect if peer ids are equal', function (t) {
  t.plan(2)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 1 })

  p1.on('error', function (err) {
    t.ok(err)
  })

  p2.on('error', function (err) {
    t.ok(err)
  })

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('connect, disconnect and reconnect', function (t) {
  t.plan(6)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

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

  p1.on('disconnect', function () {
    t.pass('p1 did disconnect')
  })

  p2.on('disconnect', function () {
    t.pass('p2 did disconnect')
    if (connectionsNeeded > 0) {
      connect()
    }
  })

  var connectionsNeeded = 4

  connect()

  function connect () {
    p1.connect(p2.id)
    p2.connect(p1.id)
  }

  function onconnect () {
    if (--connectionsNeeded === 2) {
      t.pass('did connect')
      p1.disconnect()
    } else if (connectionsNeeded === 0) {
      t.pass('did connect')
      p1.disconnect()
    }
  }
})

tape('use data channels', function (t) {
  t.plan(6)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function (track) {
    var testChannel = p1.createDataChannel('test-channel')
    testChannel.on('message', function (evt) {
      var data = evt.data
      t.equal(data instanceof ArrayBuffer, true)
      data = new Uint8Array(data)
      t.equal(data[0], 1)
      t.equal(data[1], 127)
      t.equal(data[2], 255)
      p1.disconnect()
    })
    testChannel.send('wow')
  })

  p2.on('datachannel', function (channel) {
    t.equal(channel.label, 'test-channel')
    channel.on('message', function (evt) {
      t.equal(evt.data, 'wow')
      var buffer = new ArrayBuffer(3)
      var view = new Uint8Array(buffer)
      view[0] = 1
      view[1] = 127
      view[2] = 255
      channel.send(buffer)
    })
  })

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('add media tracks from the initiator side before connect', function (t) {
  t.plan(1)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('track', function (track) {
    t.ok(track, 'got remote track')
    p1.disconnect()
  })

  var stream = ctx.createMediaStreamDestination().stream
  p2.addTrack(stream.getTracks()[0], stream)

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('add media tracks from the non-initiator side before connect', function (t) {
  t.plan(1)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p2.on('track', function (track) {
    t.ok(track, 'got remote track')
    p1.disconnect()
  })

  var stream = ctx.createMediaStreamDestination().stream
  p1.addTrack(stream.getTracks()[0], stream)

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('add media tracks from the initiator side after connect', function (t) {
  t.plan(1)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p2.on('connect', function () {
    var stream = ctx.createMediaStreamDestination().stream
    p2.addTrack(stream.getTracks()[0], stream)
  })

  p1.on('track', function (track) {
    t.ok(track, 'got remote track')
    p1.disconnect()
  })

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('add media tracks from the non-initiator side after connect', function (t) {
  t.plan(1)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    var stream = ctx.createMediaStreamDestination().stream
    p1.addTrack(stream.getTracks()[0], stream)
  })

  p2.on('track', function (track) {
    t.ok(track, 'got remote track')
    p1.disconnect()
  })

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('remove media tracks from the initiator side', function (t) {
  t.plan(2)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p2.on('connect', function () {
    var stream = ctx.createMediaStreamDestination().stream
    track = stream.getTracks()[0]
    p2.addTrack(track, stream)
  })

  p1.on('track', function (evt) {
    t.ok(evt.track, 'got remote track')
    evt.track.onended = function () {
      t.pass('remote track ended')
      p1.disconnect()
    }
    p2.removeTrack(track)
  })

  var track = null

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('remove media tracks from the non-initiator side', function (t) {
  t.plan(2)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

  p1.on('signal', function (signal) {
    p2.signal(signal)
  })

  p2.on('signal', function (signal) {
    p1.signal(signal)
  })

  p1.on('connect', function () {
    var stream = ctx.createMediaStreamDestination().stream
    track = stream.getTracks()[0]
    p1.addTrack(track, stream)
  })

  p2.on('track', function (evt) {
    t.ok(evt.track, 'got remote track')
    evt.track.onended = function () {
      t.pass('remote track ended')
      p2.disconnect()
    }
    p1.removeTrack(track)
  })

  var track = null

  p1.connect(p2.id)
  p2.connect(p1.id)
})

tape('re-add media tracks automatically after reconnect', function (t) {
  t.plan(6)

  p1 = new Peer({ id: 1 })
  p2 = new Peer({ id: 2 })

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

  p1.on('track', function (track) {
    t.ok(track, 'got remote track')
    p1.disconnect()
  })

  p2.on('disconnect', function () {
    t.pass('p2 did disconnect')
    if (connectionsNeeded > 0) {
      connect()
    }
  })

  var connectionsNeeded = 4

  connect()

  function connect () {
    p1.connect(p2.id)
    p2.connect(p1.id)
  }

  function onconnect () {
    if (--connectionsNeeded === 2) {
      t.pass('did connect once')
      var stream = ctx.createMediaStreamDestination().stream
      p2.addTrack(stream.getTracks()[0], stream)
    } else if (connectionsNeeded === 0) {
      t.pass('did connect twice')
    }
  }
})
