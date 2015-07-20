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
    self.emit('close')
  }
}

var readOnly = [
  'label',
  'ordered',
  'maxPacketLifeTime',
  'maxRetransmits',
  'protocol',
  'negotiated',
  'id',
  'readyState',
  'bufferedAmount'
]

readOnly.forEach(function (property) {
  Object.defineProperty(DataChannel.prototype, property, {
    get: function () {
      return this._channel[property]
    }
  })
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
