'use client';
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mountUI } from './mount.mjs';

const callbacks = ['onAction', 'onStateChange', 'onSave', 'onMerge', 'onSaveStatus', 'onError'];

/**
 * React wrapper around mountUI. The renderer owns field state; `document` is the latest committed
 * document and is applied when its id or revision changes. There is no controlled value round trip.
 */
export const UIRenderer = forwardRef(function UIRenderer(props, ref) {
  const { document, contract, renderers, extensionValidators, labels, debounceMs = 300, readOnly = false, styleNonce, lang, className, style } = props;
  const container = useRef(null), controller = useRef(null);
  const latest = useRef(props);
  latest.current = props;
  useImperativeHandle(ref, () => ({
    getState: () => controller.current?.getState() ?? structuredClone(latest.current.document.state),
    getDocument: () => controller.current?.getDocument() ?? structuredClone(latest.current.document),
    flush: async () => controller.current ? controller.current.flush() : structuredClone(latest.current.document.state),
    apply: (next, options) => controller.current?.apply(next, options)
  }), []);
  const present = Object.fromEntries(callbacks.map(name => [name, typeof props[name] === 'function']));
  const forward = name => present[name] ? (...args) => latest.current[name]?.(...args) : undefined;
  useEffect(() => {
    const mounted = mountUI(container.current, {
      document: latest.current.document, contract, renderers, extensionValidators, labels, debounceMs, readOnly, styleNonce, lang,
      ...Object.fromEntries(callbacks.map(name => [name, forward(name)]))
    });
    controller.current = mounted;
    return () => { mounted.destroy(); controller.current = null; };
    // The contract and renderers define what can render; changing them remounts.
  }, [contract, renderers, extensionValidators]);
  useEffect(() => {
    controller.current?.update({ debounceMs, readOnly, styleNonce, labels, ...Object.fromEntries(callbacks.map(name => [name, forward(name)])) });
  }, [debounceMs, readOnly, styleNonce, labels, ...callbacks.map(name => present[name])]);
  // Apply only real document changes; identity changes of the same revision are ignored by apply().
  useEffect(() => { controller.current?.apply(document); }, [document?.id, document?.revision, document]);
  return createElement('div', { ref: container, className, style });
});
