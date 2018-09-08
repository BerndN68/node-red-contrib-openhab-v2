/*

  OpenHAB nodes for IBM's Node-Red
  https://github.com/QNimbus/node-red-contrib-openhab2
  (c) 2018, Bas van Wetten <bas.van.wetten@gmail.com>

  Licensed under the Apache License, Version 2.0 (the 'License');
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an 'AS IS' BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
  
*/

var request = require('request');
var util = require('util');
var EventSource = require('@joeybaker/eventsource');

/**
 * Constants
 *
 */

var NODE_PATH = '/openhab2/';
var EVENTS_PATH = '/rest/events/';
var ITEMS_PATH = '/rest/items/';

var STATE = {
    EVENT_NAME: 'state',
    CONNECTING: 1,
    CONNECTED: 2,
    DISCONNECTED: 3,
    CURRENT_STATE: 4,
    IDLE: 5,
    NO_PAYLOAD: 6,
    OK: 7,
    WARN: 98,
    ERROR: 99
};

var STATE_MSG = {
    CONNECTING: 'Connecting',
    CONNECTED: 'Connected',
    DISCONNECTED: 'Disconnected',
    IDLE: '',
    NO_PAYLOAD: 'No payload specified',
    NO_TOPIC: 'No topic specified',
    OK: 'Ok',
    WARN: 'Warning',
    ERROR: 'Error'
}

var PROXY_DIR = {
    ITEM_TO_PROXY: 1,
    PROXY_TO_ITEM: 2,
}

module.exports = function (RED) {

    /**
     * httpAdmin.get
     * 
     * Enable http route to static files
     *
     */
    RED.httpAdmin.get(NODE_PATH + 'static/*', function (req, res) {
        var options = {
            root: __dirname + '/static/',
            dotfiles: 'deny'
        };
        res.sendFile(req.params[0], options);
    });

    /**
     * httpAdmin.get
     * 
     * Enable http route to OpenHAB JSON itemlist for each controller (controller id passed as GET query parameter)
     *
     */
    RED.httpAdmin.get(NODE_PATH + 'itemlist', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        var forceRefresh = config.forceRefresh ? ['1', 'yes', 'true'].includes(config.forceRefresh.toLowerCase()) : false;

        if (controller && controller instanceof OpenHAB_controller_node) {
            controller.getItemsList(function (items) {
                if (items) {
                    res.json(items).end();
                } else {
                    res.status(404).end();
                }
            }, forceRefresh);
        } else {
            res.status(404).end();
        }
    });

    /**
     * updateNodeStatus
     * 
     * Function to update node status according to the STATE & STATE_MSG enums
     * Gets called by node instance method 'updateNodeStatus' (as a 'partial' construct)
     *
     */
    updateNodeStatus = function (node, state, customMessage = undefined) {
        var currentState = node.context().get('currentState');

        switch (state) {
            case STATE.CONNECTING: {
                node.status({ fill: 'green', shape: 'ring', text: customMessage ? customMessage : STATE_MSG.CONNECTING });
                break;
            }
            case STATE.CONNECTED: {
                node.status({ fill: 'green', shape: 'dot', text: customMessage ? customMessage : STATE_MSG.CONNECTED });
                break;
            }
            case STATE.DISCONNECTED: {
                node.status({ fill: 'red', shape: 'ring', text: customMessage ? customMessage : STATE_MSG.DISCONNECTED });
                break;
            }
            case STATE.CURRENT_STATE: {
                node.status({ fill: 'green', shape: 'dot', text: customMessage ? customMessage : currentState });
                break;
            }
            case STATE.IDLE: {
                node.status({});
                break;
            }
            case STATE.NO_PAYLOAD: {
                node.status({ fill: 'red', shape: 'ring', text: customMessage ? customMessage : STATE_MSG.NO_PAYLOAD });
                break;
            }
            case STATE.NO_TOPIC: {
                node.status({ fill: 'red', shape: 'ring', text: customMessage ? customMessage : STATE_MSG.NO_TOPIC });
                break;
            }
            case STATE.OK: {
                node.status({ fill: 'green', shape: 'dot', text: customMessage ? customMessage : STATE_MSG.OK });
                break;
            }
            case STATE.ERROR: {
                node.status({ fill: 'red', shape: 'dot', text: customMessage ? customMessage : STATE_MSG.ERROR });
                break;
            }
            default: {
                node.status({ fill: 'yellow', shape: 'ring', text: customMessage ? customMessage : '?' });
                break;
            }
        }
    };

    /**
     * openhab-v2-controller
     * 
     * Holds the configuration (hostname, port, creds, etc) of the OpenHAB server
     *
     */
    function OpenHAB_controller_node(config) {
        RED.nodes.createNode(this, config);

        var globalContext = this.context().global;
        var node = this;
        var itemList = globalContext.get('openhab-v2-itemList');
        node.name = config.name;
        node.allowRawEvents = config.allowRawEvents;
        node._eventSource = undefined;
        node._itemList = itemList ? itemList : undefined;
        node._url = undefined;

        // Temporary workaround for issue #3 (https://github.com/QNimbus/node-red-contrib-openhab-v2/issues/3)
        node.setMaxListeners(50);

        /**
         * node.request
         * 
         */
        node.request = function (urlpart, options, callback) {
            options.uri = node.getURL() + urlpart;
            options.rejectUnauthorized = false;
            node.log(`Requesting URI ${options.uri} with method ${options.method}`);
            request(options, callback);
        }

        /**
         * node.send
         * 
         *
         */
        node.send = function (itemName, topic, payload, successCallback = undefined, failCallback = undefined) {
            var url = node.getURL() + `${ITEMS_PATH}${itemName}`;

            switch (topic) {
                case 'ItemUpdate': {
                    url += '/state';
                    method = request.put;
                    break;
                }
                case 'ItemCommand': {
                    method = request.post
                    break;
                }
                default: {
                    method = request.get;
                    break;
                }
            }

            method({ url: url, body: String(payload), strictSSL: false }, function (error, response, body) {
                if (error) {
                    var errorMessage = `Request error: ${error} on ${url}`;

                    node.emit(STATE.EVENT_NAME, STATE.ERROR, errorMessage);
                    if (failCallback && typeof failCallback === 'function') {
                        failCallback(errorMessage);
                    }
                }
                else if (!(200 <= response.statusCode && response.statusCode <= 210)) {
                    var errorMessage = `Response error: ${JSON.stringify(response)} on ${url}`;

                    node.emit(STATE.EVENT_NAME, STATE.ERROR, errorMessage);
                    if (failCallback && typeof failCallback === 'function') {
                        failCallback(errorMessage);
                    }
                } else {
                    if (successCallback && typeof successCallback === 'function') {
                        successCallback(body);
                    }
                }
            });
        };

        /**
         * getConfig
         * 
         * Getter for config object
         *
         */
        node.getConfig = function () {
            return config;
        }

        /**
         * getURL
         * 
         * Getter for url string; builds url string based on config parameters such as protocol, host, port, etc.
         * e.g. http://localhost:8080 or https://user@password:myzwave.controller.example.com:8443
         *
         */
        node.getURL = function () {
            var url = node._url;

            // Sort of singleton construct - if the url has been constructed before, don't create a new one
            if (true && url === undefined || !(url.prototype === String)) {
                if (config.protocol)
                    url = config.protocol;
                else
                    url = 'http';

                url += '://';

                if ((config.username != undefined) && (config.username.trim().length != 0)) {
                    url += config.username.trim();

                    if ((config.password != undefined) && (config.password.length != 0)) {
                        url += ':' + config.password;
                    }
                    url += '@';
                }
                url += config.host;

                if ((config.port != undefined) && (config.port.trim().length != 0)) {
                    url += ':' + config.port.trim();
                }

                if ((config.path != undefined) && (config.path.trim().length != 0)) {
                    var path = config.path.trim();

                    path = path.replace(/^[\/]+/, '');
                    path = path.replace(/[\/]+$/, '');

                    url += '/' + path;
                }
            }
            node._url = url;
            return url;
        }

        /**
         * getItemsList
         * 
         * Accepts a callback function that will either receive NULL in case of error or a sorted JSON item list from OpenHAB
         *
         */
        node.getItemsList = function (callback, forceRefresh = false) {
            // Sort of singleton construct
            if (forceRefresh || node._itemList === undefined) {
                var options = {
                    method: 'GET',
                    json: true,
                }
                node.request(ITEMS_PATH, options, function (error, response, body) {
                    if (error) {
                        node._itemList = undefined;
                    } else {
                        node._itemList = body;
                        globalContext.set('openhab-v2-itemList', body)
                    }
                    console.log(`Refreshing itemlist.....`);
                    callback(node._itemList);
                });
            } else {
                console.log(`Using cached itemlist....`);
                callback(node._itemList);
            }
        }

        /**
         * getItemStates
         * 
         * Fetches all items from OpenHAB and emits events for each of them to update state of item nodes in flow
         *
         */
        node.getItemStates = function () {
            var url = node.getURL() + ITEMS_PATH;
            var options = {
                method: 'GET',
                json: true,
            }

            node.request(ITEMS_PATH, options, function (error, response, body) {
                if (error) {
                    var errorMessage = `Request error: ${error} on ${url}`;
                    node.warn(errorMessage);
                    node.emit(STATE.EVENT_NAME, STATE.WARN, errorMessage);
                } else {
                    switch (response.statusCode) {
                        case 503: {
                            node.warn(`Response status 503 on ${url}, trying again in a few moments...`);
                            node.emit(STATE.EVENT_NAME, STATE.WARN);
                            setTimeout(function () {
                                node.getItemStates();
                            }, 10000);
                            break;
                        }
                        case 200: {
                            body.forEach(function (item) {
                                node.emit(item.name + '/ItemStateEvent', { type: 'ItemStateEvent', state: item.state });
                            });
                            break;
                        }
                        default: {
                            node.emit(STATE.EVENT_NAME, STATE.ERROR);
                            node.warn(`Response error ${response.statusCode} on ${url}: JSON.stringify(response)`);
                            break;
                        }
                    }
                }
            });
        }

        /* 
         * EventSource event handlers
         */

        /**
         * node.onOpen
         * 
         * onOpen event handler for eventSource watcher. Notifies all other nodes that the OpenHAB_controller_node has connected succesfully
         *
         */
        node.onOpen = function () {
            node.emit(STATE.EVENT_NAME, STATE.CONNECTED);
            node.getItemStates();
        }

        /**
         * node.onError
         * 
         * onError event handler for eventSource watcher. Notifies all other nodes that the OpenHAB_controller_node has experienced an error
         *
         */
        node.onError = function (error) {
            try {
                var errorMessage = `Unable to connect: ${error.type} on ${node._eventSource.url}`;

                node.log(util.inspect(error));

                node._eventSource.removeAllListeners();
                node._eventSource.close();

                node.emit(STATE.EVENT_NAME, STATE.ERROR, errorMessage);
                delete node._eventSource;

                setTimeout(function () {
                    node.getEventSource();
                }, 30000);
            } catch (error) {
                var errorMessage = `Unable to connect: ${JSON.stringify(error)} on ${node._eventSource.url}`;

                node._eventSource.removeAllListeners();
                node._eventSource.close();

                node.emit(STATE.EVENT_NAME, STATE.ERROR, errorMessage);
                delete node._eventSource;
                node.error(util.inspect(error));
            }
        }

        /**
         * node.onMessage
         * 
         * onMessage event handler for eventSource watcher. Parses event messages and emits appropriate events through the OpenHAB_controller_node
         * to be listened to by the other nodes
         *
         */
        node.onMessage = function (message) {
            try {
                var parsedMessage = message;
                parsedMessage = JSON.parse(parsedMessage.data);
                parsedMessage.payload = JSON.parse(parsedMessage.payload);

                const itemStart = ('smarthome/items/').length;
                var itemName = parsedMessage.topic.substring(itemStart, parsedMessage.topic.indexOf('/', itemStart));

                if (node.allowRawEvents === true) {
                    node.emit('RawEvent', message);
                    node.emit(itemName + '/RawEvent', message);
                }

                node.emit(itemName + `/${parsedMessage.type}`, { item: itemName, type: parsedMessage.type, state: parsedMessage.payload.value, payload: parsedMessage.payload });
            } catch (error) {
                var errorMessage = `Error parsing message: ${error.type.Error} - ${message}`;

                node.emit(STATE.EVENT_NAME, STATE.ERROR, errorMessage);
                node.error(`Unexpected Error: ${error}`);
            }
        }

        /**
         * node.getEventSource
         * 
         * Singleton construct to get the controller eventSource for communicating with the OpenHAB eventbus
         *
         */
        node.getEventSource = function (eventSourceCallbacks) {
            var callbacks = typeof eventSourceCallbacks !== 'object' ? {} : eventSourceCallbacks;
            var eventSource = node._eventSource;

            // Sort of singleton construct - if the eventSource has been initialized before, don't create a new one
            if (eventSource !== undefined && eventSource instanceof EventSource) {
                node.log(`Controller using previously started connection: ${eventSource.url}`);

                return eventSource;
            } else {
                var eventSourceInitDict = { rejectUnauthorized: false, https: { checkServerIdentity: false, rejectUnauthorized: false } };
                var url = node.getURL() + EVENTS_PATH + '?topics=smarthome/items';

                node.log(`Controller attempting to connect to: ${url}`);
                eventSource = new EventSource(url, eventSourceInitDict);

                eventSource.on('open', node.onOpen);
                eventSource.on('error', node.onError);
                eventSource.on('message', node.onMessage);
            }

            // Allow for custom event handlers getting passed to eventSource object

            if (callbacks.hasOwnProperty('onOpen') && typeof callbacks.onOpen === 'function') {
                eventSource.on('open', callbacks.onOpen);
            }

            if (callbacks.hasOwnProperty('onMessage') && typeof callbacks.onMessage === 'function') {
                eventSource.on('message', callbacks.onMessage);
            }

            node._eventSource = eventSource;
            return node._eventSource;
        }

        /* 
         * Node event handlers
         */

        /**
         * OpenHAB_controller_node close event handler
         * 
         * Cleanup for when the OpenHAB_controller_node gets closed
         *
         */
        node.on('close', function () {
            if (node._eventSource !== undefined && node._eventSource instanceof EventSource) {
                node._eventSource.removeAllListeners();
                node._eventSource.close();
                node.log(`Controller.eventSource disconnecting...`);
            }

            node.log(`Controller disconnecting...`);
            node.emit(STATE.EVENT_NAME, STATE.DISCONNECTED);
        });
    }
    RED.nodes.registerType('openhab-v2-controller', OpenHAB_controller_node);

    /**
     * openhab-v2-events
     * 
     * Monitors OpenHAB events
     *
     */
    function OpenHAB_events(config) {
        RED.nodes.createNode(this, config);

        var node = this;
        var openHABController = RED.nodes.getNode(config.controller);

        if (!openHABController) {
            return;
        }

        node.name = config.name;
        node.eventSource = openHABController.getEventSource();
        node.items = config.items.filter(String);
        node.disabledNodeStates = [STATE.CONNECTING, STATE.CONNECTED, STATE.DISCONNECTED];

        /* 
         * Node methods
         */

        node.updateNodeStatus = function (state, customMessage = undefined) {
            if (!node.disabledNodeStates || !node.disabledNodeStates.includes(state)) {
                updateNodeStatus(node, state, customMessage);
            } else {
                node.status({});
            }
        };

        /* 
         * Node initialization
         */

        node.updateNodeStatus(STATE.CONNECTING);
        node.context().set('currentState', undefined);

        /* 
         * Node event handlers
         */

        node.processRawEvent = function (event) {
            try {
                var sendevent = true;
                var topicRegex = new RegExp('/^smarthome\/(?:items|things)\/([^\/]+).*$/');

                event = JSON.parse(event.data);
                if (event.payload && (event.payload.constructor === String))
                    event.payload = JSON.parse(event.payload);

                if (node.items.length > 0) {
                    var matches = topicRegex.exec(event.topic);

                    if (node.items.indexOf(matches[1]) < 0) {
                        sendevent = false;
                    }
                }

                if (sendMessage) {
                    node.send(event);
                }
            } catch (error) {
                node.error('Unexpected Error : ' + error)
                node.status({ fill: 'red', shape: 'dot', text: 'Unexpected Error : ' + error });
            }
        }

        /* 
         * Attach event handlers
         */

        openHABController.addListener(STATE.EVENT_NAME, node.updateNodeStatus);
        openHABController.addListener('RawEvent', node.processRawEvent);

        node.on('close', function () {
            openHABController.removeListener('RawEvent', node.processRawEvent);
            openHABController.removeListener(STATE.EVENT_NAME, node.updateNodeStatus);
            node.log(`closing`);
        });

    }
    RED.nodes.registerType('openhab-v2-events', OpenHAB_events);

    /**
     * openhab-v2-in
     * 
     * Monitors incomming OpenHAB item events and injects JSON message into node-red flow
     *
     */
    function OpenHAB_in(config) {
        RED.nodes.createNode(this, config);

        var node = this;
        var openHABController = RED.nodes.getNode(config.controller);
        var firstMessage = true;

        if (!openHABController) {
            return;
        }

        node.name = config.name;
        node.item = config.item;
        node.outputAtStartup = config.outputAtStartup;
        node.storeStateInFlow = config.storeStateInFlow;
        node.eventTypes = config.eventTypes.filter(String);
        node.eventSource = openHABController.getEventSource();
        node.disabledNodeStatesnode = [STATE.CONNECTING, STATE.CONNECTED, STATE.DISCONNECTED];

        /* 
         * Node methods
         */

        node.updateNodeStatus = function (state, customMessage = undefined) {
            if (!node.disabledNodeStates || !node.disabledNodeStates.includes(state)) {
                updateNodeStatus(node, state, customMessage);
            } else {
                node.status({});
            }
        };

        /* 
         * Node initialization
         */

        node.updateNodeStatus(STATE.CONNECTING);
        node.context().set('currentState', undefined);

        /* 
         * Node event handlers
         */

        node.processRawEvent = function (event) {
            // Send message to node output 2
            var msgid = RED.util.generateId();
            node.send([null, { _msgid: msgid, payload: event, item: node.item, event: 'RawEvent' }]);
        }

        node.processStateEvent = function (event) {
            try {
                var currentState = node.context().get('currentState');
                var sendMessage = true;

                if (event.state != 'null') {
                    if (node.eventTypes.indexOf(event.type) < 0) {
                        sendMessage = false;
                    }

                    if (!firstMessage || node.outputAtStartup) {
                        if (sendMessage) {
                            // Send message to node output 1
                            var msgid = RED.util.generateId();
                            node.send([{ _msgid: msgid, payload: event.state, data: event.payload, item: node.item, event: event.type }, null]);
                        }
                    } else {
                        firstMessage = false;
                    }

                    node.context().set('currentState', event.state);
                    node.updateNodeStatus(STATE.CURRENT_STATE, `State: ${event.state}`);

                    if (node.storeStateInFlow === true) {
                        node.context().flow.set(`${node.item}_state`, event.state)
                    }
                }
            } catch (error) {
                node.error('Unexpected Error : ' + error)
                node.status({ fill: 'red', shape: 'dot', text: 'Unexpected Error : ' + error });
            }
        }

        /* 
         * Attach event handlers
         */

        openHABController.addListener(STATE.EVENT_NAME, node.updateNodeStatus);
        openHABController.addListener(node.item + '/RawEvent', node.processRawEvent);
        ['ItemCommandEvent', 'ItemStateEvent', 'ItemStateChangedEvent'].forEach(function (eventType) {
            openHABController.addListener(node.item + `/${eventType}`, node.processStateEvent);
        });

        node.on('close', function () {
            ['ItemCommandEvent', 'ItemStateEvent', 'ItemStateChangedEvent'].forEach(function (eventType) {
                openHABController.removeListener(node.item + `/${eventType}`, node.processStateEvent);
            });
            openHABController.removeListener(node.item + '/RawEvent', node.processRawEvent);
            openHABController.removeListener(STATE.EVENT_NAME, node.updateNodeStatus);
            node.log(`closing`);
        });
    }
    RED.nodes.registerType('openhab-v2-in', OpenHAB_in);

    /**
     * openhab-v2-out
     * 
     * Allow to send a predefind or incomming message as a command to OpenHAB
     *
     */
    function OpenHAB_out(config) {
        RED.nodes.createNode(this, config);

        var node = this;
        var openHABController = RED.nodes.getNode(config.controller);

        if (!openHABController) {
            return;
        }

        node.name = config.name;
        node.item = config.item;
        node.storeStateInFlow = config.storeStateInFlow;
        node.eventSource = openHABController.getEventSource();
        node.disabledNodeStates = [STATE.CONNECTING, STATE.CONNECTED, STATE.DISCONNECTED];

        /* 
         * Node methods
         */

        node.updateNodeStatus = function (state, customMessage = undefined) {
            if (!node.disabledNodeStates || !node.disabledNodeStates.includes(state)) {
                updateNodeStatus(node, state, customMessage);
            } else {
                node.status({});
            }
        };

        /* 
         * Node initialization
         */

        node.updateNodeStatus(STATE.IDLE);
        node.context().set('currentState', undefined);

        /* 
         * Node event handlers
         */

        node.on('input', function (message) {
            // If the node has an item, topic and/or payload configured it will override what was sent in via incomming message
            var item = config.item ? config.item : message.item;
            var topic = config.topic;
            var topicType = config.topicType;
            var payload = config.payload;
            var payloadType = config.payloadType;

            switch (topicType) {
                case 'msg': {
                    topic = message[topic];
                    break;
                }
                case 'str':
                case 'oh_cmd':
                default : {
                    // Keep selected topic
                    break;
                }
            }

            switch (payloadType) {
                case 'msg': {
                    payload = message[payload];
                    break;
                }
                case 'flow':
                case 'global': {
                    RED.util.evaluateNodeProperty(payload, payloadType, this, message, function(error, result) {
                        if (error) {
                            node.error(error, message);
                        } else {
                            payload = result;
                        }
    
                    });
                    break;
                }
                case 'date': {
                    payload = Date.now();
                    break;
                }
                case 'num':
                case 'str':
                default: {
                    // Keep selected payload
                    break;
                }
            }

            if (item && topic) {
                if (payload !== undefined) {
                    openHABController.send(item, topic, payload, null, null);
                } else {
                    node.updateNodeStatus(STATE.NO_PAYLOAD);
                }                
            }
            else {
                node.updateNodeStatus(STATE.NO_TOPIC);
            }
        });

        node.processStateEvent = function(event) {
            node.context().set('currentState', event.state);
            node.updateNodeStatus(STATE.CURRENT_STATE, `State: ${event.state}`);           

            if (node.storeStateInFlow === true) {
                node.context().flow.set(`${node.item}_state`, event.state)
            } 
        }

        /* 
         * Attach event handlers
         */

        openHABController.addListener(STATE.EVENT_NAME, node.updateNodeStatus);
        openHABController.addListener(`${node.item}/ItemStateEvent`, node.processStateEvent);

        node.on('close', function () {
            openHABController.removeListener(`${node.item}/ItemStateEvent`, node.processStateEvent);
            openHABController.removeListener(STATE.EVENT_NAME, node.updateNodeStatus);
            node.log(`closing`);
        });
    }
    RED.nodes.registerType('openhab-v2-out', OpenHAB_out);

    /**
     * openhab-v2-get
     * 
     * Allow to send a predefind or incomming message as a command to OpenHAB
     *
     */
    function OpenHAB_get(config) {
        RED.nodes.createNode(this, config);

        var node = this;
        var openHABController = RED.nodes.getNode(config.controller);

        if (!openHABController) {
            return;
        }

        node.name = config.name;
        node.item = config.item;
        node.disabledNodeStates = [STATE.CONNECTING, STATE.CONNECTED, STATE.DISCONNECTED];

        /* 
         * Node methods
         */

        node.updateNodeStatus = function (state, customMessage = undefined) {
            if (!node.disabledNodeStates || !node.disabledNodeStates.includes(state)) {
                updateNodeStatus(node, state, customMessage);
            } else {
                node.status({});
            }
        };

        /* 
         * Node initialization
         */

        node.updateNodeStatus(STATE.IDLE);
        node.context().set('currentState', undefined);

        /* 
         * Node event handlers
         */

        /* 
         * Attach event handlers
         */

        node.on('input', function (event) {
            var item = config.item ? config.item : event.item;

            function success(body) {
                event.payload_in = event.payload;
                event.payload = JSON.parse(body);
                node.send(event);
                node.updateNodeStatus(STATE.CURRENT_STATE, `State: ${event.payload.state}`);
            }

            function fail(errorMessage) {
                node.warn(errorMessage);
            }

            openHABController.send(item, null, null, success, fail);
        });

        openHABController.addListener(STATE.EVENT_NAME, node.updateNodeStatus);

        node.on('close', function () {
            openHABController.removeListener(STATE.EVENT_NAME, node.updateNodeStatus);
            node.log(`closing`);
        });
    }
    RED.nodes.registerType('openhab-v2-get', OpenHAB_get);

    /**
     * openhab-v2-proxy
     * 
     * Description
     *
     */
    function OpenHAB_proxy(config) {
        RED.nodes.createNode(this, config);

        var node = this;
        var openHABController = RED.nodes.getNode(config.controller);
        var firstMessage = true;

        if (!openHABController) {
            return;
        }

        node.name = config.name;
        node.items = config.items.filter(String);
        node.proxyItem = config.proxyItem;
        node.proxyDirection = config.proxyDirection;
        node.storeStateInFlow = config.storeStateInFlow;
        node.eventSource = openHABController.getEventSource();
        node.disabledNodeStates = [STATE.CONNECTING, STATE.CONNECTED, STATE.DISCONNECTED];

        /* 
         * Node methods
         */

        node.updateNodeStatus = function (state, customMessage = undefined) {
            if (!node.disabledNodeStates || !node.disabledNodeStates.includes(state)) {
                updateNodeStatus(node, state, customMessage);
            } else {
                node.status({});
            }
        };

        /* 
         * Node initialization
         */

        node.updateNodeStatus(STATE.IDLE);
        node.context().set('currentState', undefined);

        /* 
         * Node event handlers
         */

        node.on('input', function (message) {
            var item = node.proxyItem;
            var topic = config.topic;
            var topicType = config.topicType;
            var payload = config.payload;
            var payloadType = config.payloadType;

            switch (topicType) {
                case 'msg': {
                    topic = message[topic];
                    break;
                }
                case 'str':
                case 'oh_cmd':
                default : {
                    // Keep selected topic
                    break;
                }
            }

            switch (payloadType) {
                case 'msg': {
                    payload = message[payload];
                    break;
                }
                case 'flow':
                case 'global': {
                    RED.util.evaluateNodeProperty(payload, payloadType, this, message, function(error, result) {
                        if (error) {
                            node.error(error, message);
                        } else {
                            payload = result;
                        }
    
                    });
                    break;
                }
                case 'date': {
                    payload = Date.now();
                    break;
                }
                case 'num':
                case 'str':
                default: {
                    // Keep selected payload
                    break;
                }
            }

            if (item && topic) {
                if (payload !== undefined) {
                    openHABController.send(item, topic, payload, null, null);
                } else {
                    node.updateNodeStatus(STATE.NO_PAYLOAD);
                }                
            }
            else {
                node.updateNodeStatus(STATE.NO_TOPIC);
            }
        });

        node.processStateEvent = function(event) {
            node.context().set('currentState', event.state);
            node.updateNodeStatus(STATE.CURRENT_STATE, `State: ${event.state}`);

            if (node.storeStateInFlow === true) {
                node.context().flow.set(`${node.proxyItem}_state`, event.state)
            }
        }

        node.itemUpdate = function (event) {
            var item = node.proxyItem;
            var topic = 'ItemUpdate';
            var payload = event.state;

            if (item && topic && payload) {
                openHABController.send(item, topic, payload, null, null);

                // Update all other items that below to the proxy item
                node.items.forEach(function (item) {
                    if (item !== event.item) {
                        openHABController.send(item, topic, payload, null, null);
                    }                    
                });
            }
            else {
                node.updateNodeStatus(STATE.NO_PAYLOAD);
            }
        }

        node.proxyUpdate = function (event) {
            var topic = 'ItemUpdate';
            var payload = event.state;

            if (topic && payload) {
                node.items.forEach(function (item) {
                    openHABController.send(item, topic, payload, null, null);
                });
            }
            else {
                node.updateNodeStatus(STATE.NO_PAYLOAD);
            }
        }

        /* 
         * Attach event handlers
         */

        if (node.proxyDirection & PROXY_DIR.ITEM_TO_PROXY) {
            // Item -> Proxy item
            node.items.forEach(function (item) {
                openHABController.addListener(`${item}/ItemCommandEvent`, node.itemUpdate);
            });
        }

        if (node.proxyDirection & PROXY_DIR.PROXY_TO_ITEM) {
            // Item <- Proxy item
            openHABController.addListener(`${node.proxyItem}/ItemCommandEvent`, node.proxyUpdate);
        }

        openHABController.addListener(STATE.EVENT_NAME, node.updateNodeStatus);
        openHABController.addListener(`${node.proxyItem}/ItemStateEvent`, node.processStateEvent);

        node.on('close', function () {
            if (node.proxyDirection & PROXY_DIR.ITEM_TO_PROXY) {
                node.items.forEach(function (item) {
                    openHABController.removeListener(`${item}/ItemCommandEvent`, node.itemUpdate);
                });
            }

            if (node.proxyDirection & PROXY_DIR.PROXY_TO_ITEM) {
                // Item <- Proxy item
                openHABController.removeListener(`${node.proxyItem}/ItemCommandEvent`, node.proxyUpdate);
            }

            openHABController.removeListener(`${node.proxyItem}/ItemStateEvent`, node.processStateEvent);
            openHABController.removeListener(STATE.EVENT_NAME, node.updateNodeStatus);
            node.log(`closing`);
        });
    }
    RED.nodes.registerType('openhab-v2-proxy', OpenHAB_proxy);
}