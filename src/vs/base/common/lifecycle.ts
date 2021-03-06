/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { once } from 'vs/base/common/functional';

/**
 * Enables logging of potentially leaked disposables.
 *
 * A disposable is considered leaked if it is not disposed or not registered as the child of
 * another disposable. This tracking is very simple an only works for classes that either
 * extend Disposable or use a DisposableStore. This means there are a lot of false positives.
 */
const TRACK_DISPOSABLES = false;

const __is_disposable_tracked__ = '__is_disposable_tracked__';

function markTracked<T extends IDisposable>(x: T): void {
	if (!TRACK_DISPOSABLES) {
		return;
	}

	if (x && x !== Disposable.None) {
		try {
			x[__is_disposable_tracked__] = true;
		} catch {
			// noop
		}
	}
}

function trackDisposable<T extends IDisposable>(x: T): void {
	if (!TRACK_DISPOSABLES) {
		return;
	}

	const stack = new Error().stack!;
	setTimeout(() => {
		if (!x[__is_disposable_tracked__]) {
			console.log(stack);
		}
	}, 3000);
}

export interface IDisposable {
	dispose(): void;
}

export function isDisposable<E extends object>(thing: E): thing is E & IDisposable {
	return typeof (<IDisposable><any>thing).dispose === 'function'
		&& (<IDisposable><any>thing).dispose.length === 0;
}

export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export function dispose<T extends IDisposable>(disposables: Array<T>): Array<T>;
export function dispose<T extends IDisposable>(disposables: ReadonlyArray<T>): ReadonlyArray<T>;
export function dispose<T extends IDisposable>(disposables: T | T[] | undefined): T | T[] | undefined {
	if (Array.isArray(disposables)) {
		disposables.forEach(d => {
			if (d) {
				markTracked(d);
				d.dispose();
			}
		});
		return [];
	} else if (disposables) {
		markTracked(disposables);
		disposables.dispose();
		return disposables;
	} else {
		return undefined;
	}
}

export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
	disposables.forEach(markTracked);
	return { dispose: () => dispose(disposables) };
}

export function toDisposable(fn: () => void): IDisposable {
	return { dispose: fn };
}

export class DisposableStore implements IDisposable {
	private _toDispose = new Set<IDisposable>();
	private _isDisposed = false;

	/**
	 * Dispose of all registered disposables and mark this object as disposed.
	 *
	 * Any future disposables added to this object will be disposed of on `add`.
	 */
	public dispose(): void {
		markTracked(this);
		this._isDisposed = true;
		this.clear();
	}

	/**
	 * Dispose of all registered disposables but do not mark this object as disposed.
	 */
	public clear(): void {
		this._toDispose.forEach(item => item.dispose());
		this._toDispose.clear();
	}

	public add<T extends IDisposable>(t: T): T {
		if (!t) {
			return t;
		}

		markTracked(t);
		if (this._isDisposed) {
			console.warn('Registering disposable on object that has already been disposed.');
			t.dispose();
		} else {
			this._toDispose.add(t);
		}

		return t;
	}
}

export abstract class Disposable implements IDisposable {

	static None = Object.freeze<IDisposable>({ dispose() { } });

	private readonly _store = new DisposableStore();

	constructor() {
		trackDisposable(this);
	}

	public dispose(): void {
		markTracked(this);

		this._store.dispose();
	}

	protected _register<T extends IDisposable>(t: T): T {
		return this._store.add(t);
	}
}

export interface IReference<T> extends IDisposable {
	readonly object: T;
}

export abstract class ReferenceCollection<T> {

	private references: Map<string, { readonly object: T; counter: number; }> = new Map();

	constructor() { }

	acquire(key: string): IReference<T> {
		let reference = this.references.get(key);

		if (!reference) {
			reference = { counter: 0, object: this.createReferencedObject(key) };
			this.references.set(key, reference);
		}

		const { object } = reference;
		const dispose = once(() => {
			if (--reference!.counter === 0) {
				this.destroyReferencedObject(key, reference!.object);
				this.references.delete(key);
			}
		});

		reference.counter++;

		return { object, dispose };
	}

	protected abstract createReferencedObject(key: string): T;
	protected abstract destroyReferencedObject(key: string, object: T): void;
}

export class ImmortalReference<T> implements IReference<T> {
	constructor(public object: T) { }
	dispose(): void { /* noop */ }
}
