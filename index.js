module.exports = SimplerPeer

var webrtc = require('get-browser-rtc')()
var inherits = require('inherits')
var EventEmitter = require('events')
var DataChannel = require('./data-channel')

inherits(SimplerPeer, EventEmitter)

function SimplerPeer (opts) {
  if (!(this instanceof SimplerPeer)) {
    return new SimplerPeer(opts)
  }

  if (!webrtc) {
    throw new Error('your browser does not support WebRTC')
  }

  EventEmitter.call(this)

  this._opts = {
    iceServers: [
      {
        url: 'stun:23.21.150.121',
        urls: 'stun:23.21.150.121'
      }
    ]
  }
  for (var key in opts) {
    this._opts[key] = opts[key]
  }

  var self = this
  ;[
    '_onnegotiationneeded',
    '_onicecandidate',
    '_oniceconnectionstatechange',
    '_ondatachannel',
    '_onchannelopen',
    '_onchannelclose',
    '_onchannelmessage',
    '_ontrack'
  ].forEach(function (method) {
    self[method] = self[method].bind(self)
  })

  this.id = this._opts.id || (Math.random() + '').slice(2)
  this._localTracksPendingAdd = {}
  this._localTracksPendingRemove = {}
  this._localTracks = {}
  this._localChannels = {}
  this._remoteStreams = {}
  this._remoteStreamIds = {}
  this._remoteTrackIds = {}
}

// public API

SimplerPeer.prototype.connect = function (remoteId) {
  this._destroyConnection()
  this._createConnection()
  var connection = this.connection
  if (this.id === remoteId) {
    this.emit('error', new Error('cannot connect peers with the same id'))
    return
  }
  if (this.id > remoteId) {
    this.initiator = true
    this._channel = this._setupChannel(
      connection.createDataChannel('internal')
    )
    var self = this
    connection.createOffer().then(function (offer) {
      if (connection !== self.connection) return
      connection.setLocalDescription(offer).then(function () {
        if (connection !== self.connection) return
        self._localOffer = offer
        self.emit('signal', offer)
      }).catch(function (err) {
        if (connection !== self.connection) return
        self._destroyConnection()
        self.emit('error', err)
      })
    }).catch(function (err) {
      if (connection !== self.connection) return
      self._destroyConnection()
      self.emit('error', err)
    })
  } else {
    this.initiator = false
  }
}

SimplerPeer.prototype.disconnect = function () {
  this._destroyConnection()
}

SimplerPeer.prototype.signal = function (signal) {
  if (signal.sdp) {
    if (signal.type === 'offer') {
      this._receiveOffer(signal)
    } else {
      this._receiveAnswer(signal)
    }
  } else {
    this._receiveIceCandidate(signal)
  }
}

SimplerPeer.prototype.createDataChannel = function (label, opts) {
  if (!this.connection) return
  // TODO mirror track api?
  return new DataChannel(this.connection.createDataChannel(label, opts))
}

SimplerPeer.prototype.addTrack = function (track, stream) {
  if (stream) {
    track._stream = stream
  } else {
    stream = track._stream
  }
  if (this._localTracks[track.id] ||
      this._localTracksPendingAdd[track.id]) {
    throw new TypeError('track already added')
  }
  if (!this.connected || this._negotiating) {
    this._localTracksPendingAdd[track.id] = track
    return
  } else {
    delete this._localTracksPendingAdd[track.id]
    this._localTracks[track.id] = track
  }
  if (this.connection.addTrack) {
    track._sender = this.connection.addTrack(
      track,
      stream
    )
  } else {
    this.connection.addStream(stream)
  }
}

SimplerPeer.prototype.removeTrack = function (track) {
  if (this._localTracksPendingAdd[track.id]) {
    delete this._localTracksPendingAdd[track.id]
    return
  }
  if (!this._localTracks[track.id]) {
    throw new TypeError('unrecognized track')
  }
  if (!this.connected || this._negotiating) {
    this._localTracksPendingRemove[track.id] = track
    return
  } else {
    delete this._localTracksPendingRemove[track.id]
    delete this._localTracks[track.id]
  }
  if (this.connection.removeTrack) {
    this.connection.removeTrack(track._sender)
  } else {
    this.connection.removeStream(track._stream)
  }
}

// private API

SimplerPeer.prototype._createConnection = function () {
  if (this.connection) return
  this.connection = new webrtc.RTCPeerConnection(this._opts)
  this.connection.onicecandidate = this._onicecandidate
  this.connection.oniceconnectionstatechange = this._oniceconnectionstatechange
  this.connection.ondatachannel = this._ondatachannel
  this.connection.onnegotiationneeded = this._onnegotiationneeded
  this.connection[this.connection.addTrack ? 'ontrack' : 'onaddstream'] = this._ontrack
}

SimplerPeer.prototype._destroyConnection = function () {
  if (!this.connection) return
  var connected = this.connected
  var connection = this.connection
  var channel = this._channel
  connection.onnegotiationneeded = null
  connection.oniceconnectionstatechange = null
  connection.onicecandidate = null
  connection.ondatachannel = null
  connection[connection.addTrack ? 'ontrack' : 'onaddstream'] = null
  delete this.initiator
  delete this.connection
  delete this.connected
  delete this._channel
  delete this._localOffer
  delete this._remoteOffer
  delete this._remoteAnswer
  delete this._icecomplete
  delete this._negotiationNeeded
  delete this._negotiating
  for (var id in this._localTracks) {
    this._localTracksPendingAdd[id] = this._localTracks[id]
  }
  this._localTracks = {}
  this._localTracksPendingRemove = {}
  this._remoteStreamIds = {}
  this._remoteTrackIds = {}
  this._endRemoteTracks()
  try { channel.close() } catch (err) {}
  try { connection.close() } catch (err) {}
  if (connected) {
    this.emit('disconnect')
  }
}

SimplerPeer.prototype._receiveOffer = function (offer) {
  if (!this.connection ||
       this.initiator ||
       this._remoteOffer) {
    this.emit('error', new Error('invalid state'))
    return
  }
  offer = new webrtc.RTCSessionDescription(offer)
  this._debug('receiveOffer', offer)
  this._remoteOffer = offer
  var connection = this.connection
  var self = this
  connection.setRemoteDescription(offer).then(function () {
    if (connection !== self.connection) return
    connection.createAnswer().then(function (answer) {
      if (connection !== self.connection) return
      connection.setLocalDescription(answer).then(function () {
        if (connection !== self.connection) return
        self.emit('signal', answer)
      }).catch(function (err) {
        if (connection !== self.connection) return
        self._destroyConnection()
        self.emit('error', err)
      })
    }).catch(function (err) {
      if (connection !== self.connection) return
      self._destroyConnection()
      self.emit('error', err)
    })
  }).catch(function (err) {
    if (connection !== self.connection) return
    self._destroyConnection()
    self.emit('error', err)
  })
}

SimplerPeer.prototype._receiveAnswer = function (answer) {
  if (!this.connection ||
      !this.initiator ||
      !this._localOffer ||
       this._remoteAnswer) {
    this.emit('error', new Error('invalid state'))
    return
  }
  answer = new webrtc.RTCSessionDescription(answer)
  this._debug('receiveAnswer', answer)
  this._remoteAnswer = answer
  var connection = this.connection
  var self = this
  connection.setRemoteDescription(answer).then(function () {
    // noop
  }).catch(function (err) {
    if (connection !== self.connection) return
    self._destroyConnection()
    self.emit('error', err)
  })
}

SimplerPeer.prototype._receiveIceCandidate = function (candidate) {
  if (!this.connection) return
  candidate = new webrtc.RTCIceCandidate(candidate)
  var connection = this.connection
  var self = this
  connection.addIceCandidate(candidate).then(function () {
    if (connection !== self.connection) return
    self._debug('receiveIceCandidate', candidate)
  }).catch(function (err) {
    if (connection !== self.connection) return
    self.emit('error', err)
  })
}

SimplerPeer.prototype._onicecandidate = function (evt) {
  if (evt.target.localDescription.sdp !== this.connection.localDescription.sdp || this._icecomplete) return
  if (evt.candidate) {
    this.emit('signal', evt.candidate)
  } else {
    this._onicecomplete()
  }
}

SimplerPeer.prototype._oniceconnectionstatechange = function (evt) {
  if (evt.target.localDescription.sdp !== this.connection.localDescription.sdp) return
  var state = this.connection.iceConnectionState
  this._debug('oniceconnectionstatechange', state)
  if (state === 'failed' || state === 'closed') {
    this._destroyConnection()
  }
}

SimplerPeer.prototype._onicecomplete = function () {
  if (this._icecomplete) return
  this._icecomplete = true
  this._debug('onicecomplete')
  this.emit('icecomplete')
}

SimplerPeer.prototype._ondatachannel = function (evt) {
  if (evt.target.localDescription.sdp !== this.connection.localDescription.sdp) return
  if (this._channel) {
    this.emit('datachannel', new DataChannel(evt.channel))
  } else {
    this._debug('got channel')
    this._channel = this._setupChannel(evt.channel)
  }
}

SimplerPeer.prototype._setupChannel = function (channel) {
  channel.binaryType = 'arraybuffer'
  channel.onopen = this._onchannelopen
  channel.onclose = this._onchannelclose
  channel.onmessage = this._onchannelmessage
  return channel
}

SimplerPeer.prototype._onchannelopen = function (evt) {
  if (evt.target !== this._channel) return
  delete this._localOffer
  delete this._remoteOffer
  delete this._remoteAnswer
  this.connected = true
  this._debug('connect')
  this.emit('connect')
  this._processPendingTracks()
}

SimplerPeer.prototype._onchannelclose = function (evt) {
  if (evt.target !== this._channel) return
  this._debug('onchannelclose')
  this._destroyConnection()
}

SimplerPeer.prototype._ontrack = function (evt) {
  if (evt.target.localDescription.sdp !== this.connection.localDescription.sdp) return
  this._debug('ontrack', evt)
  if (this.connection.addTrack) {
    var remoteStream = evt.streams[0]
    this._remoteStreams[remoteStream.id] = remoteStream
  } else {
    evt = {
      track: evt.stream.getTracks()[0],
      streams: [ evt.stream ]
    }
  }
  this.emit('track', evt)
}

SimplerPeer.prototype._onnegotiationneeded = function (evt) {
  if (!this.connected) return
  if (this._negotiating) {
    this._negotiationNeeded = true
    return
  }
  var connection = this.connection
  clearTimeout(this._negotiationNeededTimeout)
  var self = this
  this._negotiationNeededTimeout = setTimeout(function () {
    if (connection !== self.connection) return
    self._negotiate()
  }, 50)
}

SimplerPeer.prototype._negotiate = function () {
  this._debug('onnegotiationneeded')
  delete this._negotiationNeeded
  this._negotiating = true
  var connection = this.connection
  var self = this
  connection.createOffer().then(function (offer) {
    if (connection !== self.connection) return
    self._localOffer = offer
    try {
      self._channel.send(
        JSON.stringify(offer)
      )
    } catch (err) {}
  }).catch(function (err) {
    if (connection !== self.connection) return
    self._finishNegotiation(err)
  })
}

SimplerPeer.prototype._onchannelmessage = function (evt) {
  if (evt.target !== this._channel) return
  this._debug('got message', evt.data)
  var message = JSON.parse(evt.data)
  switch (message.type) {
    case 'offer':
      this._handleRenegotiationOffer(message)
      break
    case 'answer':
      this._handleRenegotiationAnswer(message)
      break
  }
}

SimplerPeer.prototype._handleRenegotiationOffer = function (offer) {
  if (this._localOffer) {
    if (this.initiator) {
      return
    } else {
      delete this._localOffer
      this._negotiationNeeded = true
    }
  }
  offer = new webrtc.RTCSessionDescription(offer)
  var connection = this.connection
  var self = this
  connection.setRemoteDescription(offer).then(function () {
    if (connection !== self.connection) return
    connection.createAnswer().then(function (answer) {
      if (connection !== self.connection) return
      try {
        self._channel.send(
          JSON.stringify(answer)
        )
      } catch (err) {
        return
      }
      connection.setLocalDescription(answer).then(function () {
        if (connection !== self.connection) return
        self._finishNegotiation(null, offer)
      }).catch(function (err) {
        if (connection !== self.connection) return
        self._finishNegotiation(err)
      })
    }).catch(function (err) {
      if (connection !== self.connection) return
      self._finishNegotiation(err)
    })
  }).catch(function (err) {
    if (connection !== self.connection) return
    self._finishNegotiation(err)
  })
}

SimplerPeer.prototype._handleRenegotiationAnswer = function (answer) {
  answer = new webrtc.RTCSessionDescription(answer)
  var connection = this.connection
  var self = this
  connection.setLocalDescription(this._localOffer).then(function () {
    if (connection !== self.connection) return
    connection.setRemoteDescription(answer).then(function () {
      if (connection !== self.connection) return
      self._finishNegotiation()
    }).catch(function (err) {
      if (connection !== self.connection) return
      self._finishNegotiation(err)
    })
  }).catch(function (err) {
    if (connection !== self.connection) return
    self._finishNegotiation(err)
  })
}

SimplerPeer.prototype._finishNegotiation = function (err, offer) {
  delete this._negotiating
  delete this._localOffer
  if (err) {
    this.emit('error', err)
  } else if (offer) {
    this._remoteStreamIds = {}
    this._remoteTrackIds = {}
    var self = this
    offer.sdp.split('msid:').slice(1).forEach(function (line) {
      var parts = line.split(' ')
      var streamId = parts[0]
      var trackId = parts[1].split(/\r|\n/)[0]
      self._remoteStreamIds[streamId] = true
      self._remoteTrackIds[trackId] = true
    })
    this._endRemoteTracks()
  }
  this._processPendingTracks()
  this._checkNegotiationNeeded()
}

SimplerPeer.prototype._endRemoteTracks = function () {
  for (var id in this._remoteStreams) {
    var stream = this._remoteStreams[id]
    var needsRemoval = !this._remoteStreamIds[id]
    if (needsRemoval) {
      delete this._remoteStreams[id]
    }
    var self = this
    stream.getTracks().forEach(function (track) {
      if (track.readyState !== undefined) return
      if (!self._remoteTrackIds[track.id]) {
        track.onended && track.onended()
        track.dispatchEvent(new window.Event('ended'))
      }
    })
    if (needsRemoval) {
      if (stream.readyState !== undefined) return
      stream.onended && stream.onended()
      stream.dispatchEvent(new window.Event('ended'))
    }
  }
}

SimplerPeer.prototype._processPendingTracks = function () {
  for (var id in this._localTracksPendingRemove) {
    var track = this._localTracksPendingRemove[id]
    delete this._localTracksPendingRemove[id]
    this.removeTrack(track)
  }
  for (id in this._localTracksPendingAdd) {
    track = this._localTracksPendingAdd[id]
    delete this._localTracksPendingAdd[id]
    this.addTrack(track)
  }
}

SimplerPeer.prototype._checkNegotiationNeeded = function () {
  if (!this._negotiationNeeded) return
  this._negotiate()
}

SimplerPeer.prototype._debug = function () {
  // console.log.apply(console, [ this.id ].concat(Array.from(arguments)))
}
