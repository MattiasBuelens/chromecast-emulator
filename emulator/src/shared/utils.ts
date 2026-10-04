export const randomId = (): string =>
	typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: Date.now().toString(36) + Math.random().toString(36).slice(2)

/**
 * Define `on<name>` event handler properties, like the ones on built-in event targets.
 * The class declares their types with `declare on<name>: ...`.
 */
export const defineEventHandlers = (proto: EventTarget, names: readonly string[]): void => {
	for (const name of names) {
		const key = Symbol(`on${name}`)
		type Target = EventTarget & { [key]?: EventListener | null }
		Object.defineProperty(proto, `on${name}`, {
			configurable: true,
			enumerable: true,
			get(this: Target) {
				return this[key] || null
			},
			set(this: Target, handler: unknown) {
				if (this[key]) this.removeEventListener(name, this[key])
				this[key] = typeof handler === 'function' ? (handler as EventListener) : null
				if (this[key]) this.addEventListener(name, this[key])
			}
		})
	}
}
