var SimplerPeer = require('./')
var tape = require('tape')

var p1 = null
var p2 = null

tape('connect', function (t) {
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
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
  })

  p1.on('datachannel', function () {
    t.fail('p1 should not have seen default channel open')
  })

  p2.on('datachannel', function (channel) {
    t.equal(channel.label, 'default', 'p2 saw default channel open')
  })
})

tape('data', function (t) {
  t.plan(5)

  p2.defaultChannel.on('message', function (evt) {
    t.equal(evt.data, 'wow')
    var buffer = new ArrayBuffer(3)
    var view = new Uint8Array(buffer)
    view[0] = 1
    view[1] = 127
    view[2] = 255
    p2.defaultChannel.send(buffer)
  })

  p1.defaultChannel.on('message', function (evt) {
    var data = evt.data
    t.equal(data instanceof ArrayBuffer, true)
    data = new Uint8Array(data)
    t.equal(data[0], 1)
    t.equal(data[1], 127)
    t.equal(data[2], 255)
  })

  p1.defaultChannel.send('wow')
})

tape('close', function (t) {
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

tape('trickle connect', function (t) {
  t.plan(5)

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
  })

  p2.on('connect', function () {
    t.pass('p2 connected')
  })

  p1.on('datachannel', function () {
    t.fail('p1 should not have seen default channel open')
  })

  p2.on('datachannel', function (channel) {
    t.equal(channel.label, 'default', 'p2 saw default channel open')
  })
})

tape('trickle close', function (t) {
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
