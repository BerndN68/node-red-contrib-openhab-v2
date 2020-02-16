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

/* eslint-env browser,jquery */
/* global RED,SlimSelect */
/* global getItems */ // From node-red-openhab-v2-utilities.js

RED.nodes.registerType('openhab-v2-out', {
  category: 'OpenHAB',
  // Styling
  icon: 'node-red-contrib-openhab-v2-color.png',
  color: '#fff',
  align: 'left',
  paletteLabel: 'out',
  label: function() {
    return this.name || this.item || 'out';
  },
  labelStyle: function() {
    return this.name || this.item ? 'node_label_italic' : '';
  },
  // Inputs & outputs
  inputs: 1,
  outputs: 0,
  inputLabels: ['StateEvent'],
  outputLabels: [],
  // Default
  defaults: {
    name: {
      value: ''
    },
    controller: {
      value: '',
      type: 'openhab-v2-controller',
      required: true
    },
    item: {
      value: '',
      required: false
    },
    ohTimestamp: {
      value: false,
      required: true
    },
    eventTypes: {
      value: [],
      required: true
    },
    initialOutput: {
      value: true,
      required: true
    },
    storeState: {
      value: false,
      required: true
    }
  },
  // Dialog events
  oneditprepare: function() {
    /**
     * Initialization
     */
    const node = this;
    const controller = $('#node-input-controller').val();

    /**
     * Methods
     */

    const populateItemList = async selectedItem => {
      const itemList = await getItems(controller);
      const items = [];

      // Construct itemList array for use with SlimSelect
      for (let i = 0; i < itemList.length; i++) {
        const selected = itemList[i].name === selectedItem;
        items.push({ text: itemList[i].name, value: itemList[i].name, selected });
      }

      // Sort SlimSelect options alphabetically and case-insensitive
      items.sort((a, b) => {
        a = a.text.toLowerCase();
        b = b.text.toLowerCase();

        if (a < b) return -1;
        else if (a > b) return 1;
        else return 0;
      });

      // Preserve existing HTML DOM children of select element
      // This is mostly required because of the 'empty' option we
      // need in order for the 'deselect' function to work properly
      const children = $(slimSelectItem.select.element).children();

      // Load the data into the SlimSelect list
      slimSelectItem.setData(items);

      // Reconfigure the SlimSelect box
      const placeHolderText =
        items.length > 0
          ? node._('openhab-v2.out.labels.placeholderSelectItem', { defaultValue: 'Select item' })
          : node._('openhab-v2.out.labels.placeholderEmptyList', { defaultValue: 'No items found' });
      slimSelectItem.config.placeholderText = placeHolderText;
      slimSelectItem.config.allowDeselect = true;
      slimSelectItem.config.allowDeselectOption = true;

      // Finally restore child(ren) from select element
      $(slimSelectItem.select.element).prepend(children);
    };

    /**
     * Configure input elements
     */

    // *** Controller ***

    /* eslint-disable no-unused-vars */
    const slimSelectController = new SlimSelect({
      select: '#node-input-controller',
      showSearch: false,
      hideSelectedOption: true
    });
    /* eslint-enable no-unused-vars */

    // *** Item ***

    const slimSelectItem = new SlimSelect({
      select: '#node-input-item',
      placeholder: node._('openhab-v2.out.labels.placeholderLoading', { defaultValue: 'Loading...' }),
      searchText: node._('openhab-v2.out.labels.searchNoResults', { defaultValue: 'No results' }),
      searchPlaceholder: node._('openhab-v2.out.labels.searchPlaceholder', { defaultValue: 'Search' }),
      deselectLabel: '<span>&#10006;</span>',
      allowDeselect: false,
      allowDeselectOption: false,
      showOptionTooltips: true
    });

    populateItemList(node.item);

    // *** Event types ***

    /* eslint-disable no-unused-vars */
    const slimSelectEventTypes = new SlimSelect({
      select: '#node-input-eventTypes',
      deselectLabel: '<span>&#10006;</span>',
      showSearch: false,
      hideSelectedOption: true
    });
    /* eslint-enable no-unused-vars */
  },
  oneditsave: function() {},
  oneditcancel: function() {},
  oneditdelete: function() {},
  oneditresize: function() {}
});