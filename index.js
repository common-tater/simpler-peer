module.exports = SimplerPeer

var webrtc = require('get-browser-rtc')()
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var DataChannel = require('./data-channel')
var sessionRegex = /\no=[^ ]* ([^ ]*) ([^ ]*)/

inherits(SimplerPeer, EventEmitter)

function SimplerPeer (opts) {
  if (!(this instanceof SimplerPeer)) {
    return new SimplerPeer(opts)
  }

  if (!webrtc) {
    throw new Error('your browser does not support WebRTC')
  }

  opts = opts || {}
  opts.config = opts.config || {
    iceServers: [
      {
        url: 'stun:23.21.150.121',
        urls: 'stun:23.21.150.121'
      }
    ]
  }

  EventEmitter.call(this)

  this._onSetRemoteDescription = this._onSetRemoteDescription.bind(this)
  this._onSetLocalDescription = this._onSetLocalDescription.bind(this)
  this._onSetRemoteAnswer = this._onSetRemoteAnswer.bind(this)
  this._onSetLocalAnswer = this._onSetLocalAnswer.bind(this)
  this._onCreateOffer = this._onCreateOffer.bind(this)
  this._onCreateAnswer = this._onCreateAnswer.bind(this)
  this._onChannelOpen = this._onChannelOpen.bind(this)
  this._onChannelMessage = this._onChannelMessage.bind(this)
  this._onIceComplete = this._onIceComplete.bind(this)
  this._onError = this._onError.bind(this)
  this.close = this.close.bind(this)

  this.id = opts.id || (Math.random() + '').slice(2)
  this.trickle = opts.trickle !== undefined ? opts.trickle : true
  this.remoteStreams = {}
  this.remoteStreamIds = {}
  this.remoteTrackIds = {}
  this.connection = new webrtc.RTCPeerConnection(opts.config)
  this.connection.ondatachannel = this._onDataChannel.bind(this)
  this.connection.onicecandidate = this._onIceCandidate.bind(this)
  this.connection.oniceconnectionstatechange = this._onIceConnectionStateChange.bind(this)
  this.connection.onnegotiationneeded = this._onNegotiationNeeded.bind(this)
  this.connection[this.connection.addTrack ? 'ontrack' : 'onaddstream'] = this._onTrack.bind(this)

  if (opts.initiator) {
    this.connect()
  }
}

SimplerPeer.prototype.connect = function (signal) {
  if (this._channel) {
    throw new Error('connection already initialized')
  }

  this._channel = this.createDataChannel('internal')
  this._channel.once('open', this._onChannelOpen)
}

SimplerPeer.prototype.signal = function (signal) {
  if (this.closed) {
    this._onError(new Error('cannot signal after connection has closed'))
  }

  if (typeof signal === 'string') {
    signal = JSON.parse(signal)
  }

  if (signal.sdp) {
    this._processRemoteSessionDescription(signal)
  } else {
    this._processRemoteIceCandidate(signal)
  }
}

SimplerPeer.prototype.createDataChannel = function (label, opts) {
  debug(this.id, 'createDataChannel', label)

  return new DataChannel(this.connection.createDataChannel(label, opts))
}

SimplerPeer.prototype.addTrack = function (track, firstStream) {
  debug(this.id, 'addTrack', track)

  this.negotiationNeeded = true
  if (this.connection.addTrack) {
    return this.connection.addTrack.apply(
      this.connection,
      arguments
    )
  } else {
    this.connection.addStream(firstStream)
    return firstStream
  }
}

SimplerPeer.prototype.removeTrack = function (sender) {
  debug(this.id, 'removeTrack', sender)

  this.negotiationNeeded = true
  if (this.connection.removeTrack) {
    this.connection.removeTrack(sender)
  } else {
    this.connection.removeStream(sender)
  }
}

SimplerPeer.prototype.close = function () {
  if (this.closed) return
  this.closed = true
  this.connected = false

  debug(this.id, 'close')

  try {
    this._channel.close()
  } catch (err) {}

  try {
    this.connection.close()
  } catch (err) {}

  this.emit('close')
}

// private API below

SimplerPeer.prototype._onNegotiationNeeded = function (evt) {
  if (this.closed) return

  debug(this.id, 'onNegotiationNeeded', !!evt, !!this._localOffer, !!this._remoteOffer)

  this.emit('negotiationneeded')

  if (this._localOffer || this._remoteOffer) {
    if (this._localOffer && this._localOffer.sdp) {
      this.negotiationNeeded = true
    }
    return
  } else {
    delete this.negotiationNeeded
  }

  this._localOffer = {}
  this.connection.createOffer(
    this._onCreateOffer,
    this._onError
  )
}

SimplerPeer.prototype._onCreateOffer = function (offer) {
  debug(this.id, 'onCreateOffer', offer)

  this._localOffer = offer

  if (this.connected) {
    this._channel.send(
      JSON.stringify(offer)
    )
  } else {
    this.connection.setLocalDescription(
      offer,
      this._onSetLocalDescription,
      this._onError
    )
  }
}

SimplerPeer.prototype._processRemoteSessionDescription = function (signal) {
  // workaround for FF not triggering track.onended
  this.remoteStreamIds = {}
  this.remoteTrackIds = {}
  signal.sdp.split('msid:').slice(1).forEach(line => {
    var parts = line.split(' ')
    this.remoteStreamIds[parts[0]] = true
    this.remoteTrackIds[parts[1]] = true
  })

  if (signal.type === 'offer') {
    this._processRemoteOffer(signal)
  } else if (signal.type === 'answer') {
    this._processRemoteAnswer(signal)
  }
}

SimplerPeer.prototype._processRemoteOffer = function (offer) {
  if (this._localOffer && !this._remoteAnswer) {
    if (this.connection.signalingState === 'have-local-offer') {
      this._onError(new Error('sdp rollback not yet supported'))
      this.close()
      return
    }
    var didChooseLocalOffer = this._compareOffers(this._localOffer, offer)
    delete this._localOffer
    if (didChooseLocalOffer) {
      return
    } else {
      this.negotiationNeeded = true
    }
  }

  debug(this.id, 'got offer', offer)

  this._remoteOffer = offer
  this.connection.setRemoteDescription(
    new webrtc.RTCSessionDescription(offer),
    this._onSetRemoteDescription,
    this._onError
  )
}

SimplerPeer.prototype._compareOffers = function (a, b) {
  return a.sdp.match(sessionRegex)[1] > b.sdp.match(sessionRegex)[1]
}

SimplerPeer.prototype._onSetRemoteDescription = function () {
  debug(this.id, 'onSetRemoteDescription')

  this.connection.createAnswer(
    this._onCreateAnswer,
    this._onError
  )
}

SimplerPeer.prototype._onCreateAnswer = function (answer) {
  debug(this.id, 'onCreateAnswer', answer)

  delete this._remoteOffer

  if (this.connected) {
    this._channel.send(
      JSON.stringify(answer)
    )
  } else if (this.trickle) {
    this.emit('signal', answer)
  }

  this.connection.setLocalDescription(
    answer,
    this._onSetLocalAnswer,
    this._onError
  )
}

SimplerPeer.prototype._onSetLocalAnswer = function () {
  // workaround for FF not triggering track.onended
  for (var id in this.remoteStreams) {
    var stream = this.remoteStreams[id]
    stream.getTracks().forEach(track => {
      if (track.readyState !== undefined) return
      if (!this.remoteTrackIds[track.id]) {
        track.onended && track.onended()
        track.dispatchEvent(new Event('ended'))
      }
    })
    if (!this.remoteStreamIds[id]) {
      delete this.remoteStreams[id]
    }
  }

  delete this._localOffer
  this._checkNegotiationNeeded()
}

SimplerPeer.prototype._processRemoteAnswer = function (answer) {
  if (!this._localOffer) return

  debug(this.id, 'got answer', answer)

  this._remoteAnswer = new webrtc.RTCSessionDescription(answer)

  if (this.connected) {
    this.connection.setLocalDescription(
      this._localOffer,
      this._onSetLocalDescription,
      this._onError
    )
  } else {
    this._onSetLocalDescription()
  }
}

SimplerPeer.prototype._onSetLocalDescription = function () {
  debug(this.id, 'onSetLocalDescription')

  if (this._remoteAnswer) {
    var answer = this._remoteAnswer
    delete this._remoteAnswer
    this.connection.setRemoteDescription(
      answer,
      this._onSetRemoteAnswer,
      this._onError
    )
  } else if (this.trickle) {
    this.emit('signal', this.connection.localDescription)
  }
}

SimplerPeer.prototype._onSetRemoteAnswer = function () {
  delete this._localOffer
  this._checkNegotiationNeeded()
}

SimplerPeer.prototype._checkNegotiationNeeded = function () {
  if (this.negotiationNeeded) {
    delete this.negotiationNeeded
    this._onNegotiationNeeded()
  }
}

SimplerPeer.prototype._processRemoteIceCandidate = function (candidate) {
  debug(this.id, 'got candidate', candidate)

  this.connection.addIceCandidate(
    new webrtc.RTCIceCandidate(candidate),
    noop,
    this._onError
  )
}

SimplerPeer.prototype._onIceCandidate = function (evt) {
  if (this.closed) return

  debug(this.id, 'onIceCandidate', evt)

  if (this.trickle) {
    if (evt.candidate) {
      this.emit('signal', evt.candidate)
    }
  } else {
    clearTimeout(this._iceGatheringTimeout)
    if (!evt.candidate) {
      this._onIceComplete()
    } else {
      this._iceGatheringTimeout = setTimeout(this._onIceComplete, 250)
    }
  }
}

SimplerPeer.prototype._onIceConnectionStateChange = function (evt) {
  if (this.closed) return

  var state = this.connection.iceConnectionState

  debug(this.id, 'statechange', state)

  this.emit('statechange', state)

  if (state === 'completed' || state === 'connected') {
    this._onIceComplete()
  } else if (state === 'failed' || state === 'closed') {
    this.close()
  }
}

SimplerPeer.prototype._onIceComplete = function () {
  if (this.closed) return

  this.connection.onicecandidate = null
  this._onIceComplete = noop

  debug(this.id, 'onIceComplete')

  if (!this.trickle) {
    this.emit('signal', this.connection.localDescription)
  }
}

SimplerPeer.prototype._onDataChannel = function (evt) {
  if (this.closed) return

  var channel = new DataChannel(evt.channel)
  if (channel.label === 'internal' && !this._channel) {
    debug(this.id, 'onDataChannel (internal)', channel)

    this._channel = channel
    this._channel.on('open', this._onChannelOpen)
  } else {
    debug(this.id, 'onDataChannel', channel)

    this.emit('datachannel', channel)
  }
}

SimplerPeer.prototype._onChannelOpen = function () {
  if (this.closed) return

  debug(this.id, 'connect')

  this._channel.on('close', this.close)
  this._channel.on('message', this._onChannelMessage)
  this.connected = true
  this.emit('connect')
}

SimplerPeer.prototype._onChannelMessage = function (evt) {
  if (this.closed) return

  debug(this.id, 'onChannelMessage', evt.data)

  this.signal(evt.data)
}

SimplerPeer.prototype._onTrack = function (evt) {
  if (this.closed) return

  debug(this.id, 'onTrack', evt)

  if (this.connection.addTrack) {
    var remoteStream = evt.streams[0]
    this.remoteStreams[remoteStream.id] = remoteStream
  } else {
    evt = {
      track: evt.stream.getTracks()[0],
      streams: [ evt.stream ],
    }
  }

  this.emit('track', evt)
}

SimplerPeer.prototype._onError = function (err) {
  debug(this.id, 'error', err)

  this.emit('error', err)
}

function debug () {
  // console.log.apply(console, arguments)
}

function noop () {}
