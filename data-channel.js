module.exports = DataChannel

var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter

inherits(DataChannel, EventEmitter)

function DataChannel (channel) {
  if (!(this instanceof DataChannel)) {
    return new DataChannel(channel)
  }

  this._channel = channel

  EventEmitter.call(this)

  var self = this

  this._channel.onopen = function () {
    self.emit('open')
  }

  this._channel.onmessage = function (message) {
    self.emit('message', message)
  }

  this._channel.onerror = function (err) {
    self.emit('error', err)
  }

  this._channel.onclose = function () {
    self.emit('open')
  }
}

Object.defineProperty(DataChannel.prototype, 'label', {
  get: function () {
    return this._channel.label
  }
})

Object.defineProperty(DataChannel.prototype, 'ordered', {
  get: function () {
    return this._channel.ordered
  }
})

Object.defineProperty(DataChannel.prototype, 'maxPacketLifeTime', {
  get: function () {
    return this._channel.maxPacketLifeTime
  }
})

Object.defineProperty(DataChannel.prototype, 'maxRetransmits', {
  get: function () {
    return this._channel.maxRetransmits
  }
})

Object.defineProperty(DataChannel.prototype, 'protocol', {
  get: function () {
    return this._channel.protocol
  }
})

Object.defineProperty(DataChannel.prototype, 'negotiated', {
  get: function () {
    return this._channel.negotiated
  }
})

Object.defineProperty(DataChannel.prototype, 'id', {
  get: function () {
    return this._channel.id
  }
})

Object.defineProperty(DataChannel.prototype, 'readyState', {
  get: function () {
    return this._channel.readyState
  }
})

Object.defineProperty(DataChannel.prototype, 'bufferedAmount', {
  get: function () {
    return this._channel.bufferedAmount
  }
})

Object.defineProperty(DataChannel.prototype, 'binaryType', {
  get: function () {
    return this._channel.binaryType
  },
  set: function (binaryType) {
    this._channel.binaryType = binaryType
  }
})

DataChannel.prototype.send = function (message) {
  return this._channel.send(message)
}

DataChannel.prototype.close = function () {
  return this._channel.close()
}
