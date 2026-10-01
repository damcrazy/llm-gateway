'use client';

import * as React from 'react';
import { motion, isMotionComponent, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/lib/utils';

type AnyProps = Record<string, unknown>;

type DOMMotionProps<T extends HTMLElement = HTMLElement> = Omit<
  HTMLMotionProps<keyof HTMLElementTagNameMap>,
  'ref'
> & { ref?: React.Ref<T> };

type WithAsChild<Base extends object> =
  | (Base & { asChild: true; children: React.ReactElement })
  | (Base & { asChild?: false | undefined });

type SlotProps<T extends HTMLElement = HTMLElement> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any;
} & DOMMotionProps<T>;

function mergeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.RefObject<T | null>).current = node;
      }
    });
  };
}

function mergeProps<T extends HTMLElement>(
  childProps: AnyProps,
  slotProps: DOMMotionProps<T>,
): AnyProps {
  const merged: AnyProps = { ...childProps, ...slotProps };

  if (childProps.className || slotProps.className) {
    merged.className = cn(
      childProps.className as string,
      slotProps.className as string,
    );
  }

  if (childProps.style || slotProps.style) {
    merged.style = {
      ...(childProps.style as React.CSSProperties),
      ...(slotProps.style as React.CSSProperties),
    };
  }

  return merged;
}

// Local fix (not in the Animate UI registry yet): children passed from a
// Server Component can arrive as a lazy reference rather than an element.
// Unwrap it the same way Radix's Slot does, and never call motion.create()
// with an undefined type.
const REACT_LAZY_TYPE = Symbol.for('react.lazy');

type LazyElement = { $$typeof: symbol; _payload: PromiseLike<unknown> };

function isLazyElement(node: unknown): node is LazyElement {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { $$typeof?: unknown }).$$typeof === REACT_LAZY_TYPE &&
    typeof (node as { _payload?: { then?: unknown } })._payload?.then ===
      'function'
  );
}

function Slot<T extends HTMLElement = HTMLElement>({
  children: rawChildren,
  ref,
  ...props
}: SlotProps<T>) {
  const children = isLazyElement(rawChildren)
    ? React.use(rawChildren._payload)
    : rawChildren;
  const element = React.isValidElement(children) ? children : null;
  const type = element?.type as React.ElementType | undefined;

  const isAlreadyMotion =
    typeof type === 'object' && type !== null && isMotionComponent(type);

  const Base = React.useMemo(
    () => (!type ? null : isAlreadyMotion ? type : motion.create(type)),
    [isAlreadyMotion, type],
  );

  if (!element || !Base) return null;

  const { ref: childRef, ...childProps } = element.props as AnyProps;

  const mergedProps = mergeProps(childProps, props);

  return (
    <Base {...mergedProps} ref={mergeRefs(childRef as React.Ref<T>, ref)} />
  );
}

export {
  Slot,
  type SlotProps,
  type WithAsChild,
  type DOMMotionProps,
  type AnyProps,
};
