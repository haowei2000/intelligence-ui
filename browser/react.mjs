'use client';
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mountDocument } from './mount.mjs';

/** A controlled React wrapper around the framework-independent renderer. */
export const DocumentRenderer = forwardRef(function DocumentRenderer({ value, onChange, onSave, onSaved, onSaveStatus, onError, debounceMs = 300, readOnly = false, styleNonce, className, style }, ref) {
  const container = useRef(null), controller = useRef(null);
  const latest = useRef({ value, onChange, onSave, onSaved, onSaveStatus, onError });
  latest.current = { value, onChange, onSave, onSaved, onSaveStatus, onError };
  useImperativeHandle(ref, () => ({
    getDocument: () => controller.current ? controller.current.getDocument() : structuredClone(latest.current.value),
    flush: async () => controller.current ? controller.current.flush() : structuredClone(latest.current.value)
  }), []);
  useEffect(() => {
    const mounted = mountDocument(container.current, {
      document: latest.current.value,
      onChange: (...args) => latest.current.onChange?.(...args),
      onSave: latest.current.onSave ? (...args) => latest.current.onSave(...args) : undefined,
      onSaved: (...args) => latest.current.onSaved?.(...args),
      onSaveStatus: (...args) => latest.current.onSaveStatus?.(...args),
      onError: (...args) => latest.current.onError?.(...args),
      debounceMs, readOnly, styleNonce
    });
    controller.current = mounted;
    return () => { mounted.destroy(); controller.current = null; };
  }, []);
  useEffect(() => {
    controller.current?.update(value, {
      onSave: onSave ? (...args) => latest.current.onSave(...args) : undefined,
      debounceMs, readOnly, styleNonce
    });
  }, [value, onSave, debounceMs, readOnly, styleNonce]);
  return createElement('div', { ref: container, className, style });
});
