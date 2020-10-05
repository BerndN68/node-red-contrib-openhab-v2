/*

OpenHAB nodes for IBM's Node-Red
https://github.com/QNimbus/node-red-contrib-openhab2
(c) 2020, Bas van Wetten <bas.van.wetten@gmail.com>

MIT License

Copyright (c) 2020 B. van Wetten

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

module.exports = function(RED) {
  /**
   * Local imports
   */

  const STATES = require('./includes/states');
  const updateNodeStatus = require('./includes/utility').updateNodeStatus;

  /**
   * Node definition
   */

  function OpenHABNodeIn(config) {
    /**
     * Initialization
     */
    const node = this;
    const controller = RED.nodes.getNode(config.controller);
    RED.nodes.createNode(node, config);

    if (!controller) {
      node.warn('No controller');
      updateNodeStatus(node, STATES.NODE_STATE, STATES.NODE_STATE_TYPE.ERROR, 'No controller');
      return false;
    }

    // Load node configuration
    node.name = config.name;
    node.items = config.items;
    node.eventTypes = config.eventTypes;
    node.initialOutput = config.initialOutput;
    node.get = node.context().get.bind(node);
    node.set = node.context().set.bind(node);
    node.flow = node.context().flow;
    node.global = node.context().global;

    // setState and getState methods for storing state values in node, flow and/or global context
    node.getState = () => node.get('states');
    node.setState = ({ item, state }) => {
      const context = node.context()[config.storeStateVariableType];
      const currentNodeState = node.getState();

      // // Try to parse state as number
      // const parsedState = parseFloat(state);
      // state = isNaN(parsedState) ? state : parsedState;

      // Write state to node variable
      node.set('states', { ...currentNodeState, [item]: state });

      // Optionally write state to flow/global variable
      if (config.storeState && config.storeStateVariable && context) {
        const currentState = context.get(config.storeStateVariable);
        context.set(config.storeStateVariable, { ...currentState, [item]: state });
      }
    };;

    // Node constants
    node.timeZoneOffset = Object.freeze(new Date().getTimezoneOffset() * 60000);

    // getCurrentTimestamp
    node.getCurrentTimestamp = config.ohTimestamp ? () => new Date(Date.now() - node.timeZoneOffset).toISOString().slice(0, -1) : Date.now;

    /**
     * Node methods
     */

    /**
     * Node event handlers
     */

    node.onControllerEvent = (event, message) => {
      // Always update node state
      updateNodeStatus(node, STATES.EVENTSOURCE_STATE, event, message);

      switch (event) {
        // If the controller just connected to the EventSource
        case STATES.EVENTSOURCE_STATE_TYPE.CONNECTED: {
          // If we have an item configured
          if (node.items) {
            // Fetch current state of item
            node.items.forEach(item => {
              controller
                .getItem(item)
                .then(({ state }) => {
                  node.setState({ item, state });
                  if (node.initialOutput) {
                    // Output initial state message
                    node.onEvent({ item, state });
                  }
                })
                .catch(error => {
                  // Log error message
                  node.warn(error.message);

                  // Change node state
                  updateNodeStatus(node, STATES.NODE_STATE, STATES.NODE_STATE_TYPE.ERROR, error.message);
                });
            });
          }
          break;
        }
        // Ignore other events
        default: {
          break;
        }
      }
    };

    node.onEvent = event => {
      const { payload, state, item, ...inMessage } = event;
      const timestamp = node.getCurrentTimestamp();
      const message = { payload: { state, item, timestamp, ...inMessage } };

      // Send node message
      // See: https://nodered.org/blog/2019/09/13/cloning-messages#cloning-by-default
      node.send([message], false);

      // // Update node state
      // updateNodeStatus(node, STATES.NODE_STATE, STATES.NODE_STATE_TYPE.CURRENT_STATE, state);

      node.setState({ item, state });
    };

    /**
     * Attach event handlers
     */

    // Listen for state changes from controller
    controller.on(STATES.EVENTSOURCE_STATE, node.onControllerEvent);
    node.debug(`Attaching 'controller' event listener '${STATES.EVENTSOURCE_STATE}'`);

    // Listen for subscribed events for selected items
    if (node.items) {
      node.items.forEach(item => {
        node.eventTypes.forEach(eventType => {
          controller.on(`${item}/${eventType}`, node.onEvent);
          node.debug(`Attaching 'node' event listener '${item}/${eventType}'`);
        });
      });
    }

    // Cleanup event listeners upon node removal
    node.on('close', () => {
      controller.removeListener(STATES.EVENTSOURCE_STATE, node.onControllerEvent);
      node.debug(`Removing 'controller' event listener '${STATES.EVENTSOURCE_STATE}'`);

      if (node.items) {
        node.items.forEach(item => {
          node.eventTypes.forEach(eventType => {
            controller.removeListener(`${item}/${eventType}`, node.onEvent);
            node.debug(`Removing 'node' event listener '${item}/${eventType}'`);
          });
        });
      }
      node.debug('Closing node');
    });

    /**
     * Node main
     */
  }

  /**
   * Register node
   */

  RED.nodes.registerType('openhab-v2-in', OpenHABNodeIn);
};
