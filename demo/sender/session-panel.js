/**
 * The "Cast session" panel: what the Cast SDK knows about the session, with buttons to end it.
 *
 * Everything here comes from the Cast SDK's CastContext and RemotePlayer, so it shows exactly what
 * a real sender app would see.
 */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id))

/** Wait until the Cast framework is ready, like <castable-video> does. */
const whenCastFrameworkReady = async () => {
	await customElements.whenDefined('google-cast-button')
	return cast.framework
}

const STATE_TEXT = {
	NO_DEVICES_AVAILABLE: 'No receivers found',
	NOT_CONNECTED: 'Not casting',
	CONNECTING: 'Connecting…',
	CONNECTED: 'Connected'
}

export const setupSessionPanel = async () => {
	const framework = await whenCastFrameworkReady()
	const context = framework.CastContext.getInstance()
	const player = new framework.RemotePlayer()
	const controller = new framework.RemotePlayerController(player)

	const update = () => {
		const castState = context.getCastState()
		const session = context.getCurrentSession()
		const connected = castState === framework.CastState.CONNECTED && !!session
		const device = session?.getCastDevice()

		const state = $('session-state')
		state.dataset.state = castState.toLowerCase()
		$('session-state-text').textContent =
			connected && device
				? `Connected to “${device.friendlyName}”`
				: STATE_TEXT[castState] || castState

		$('session-details').hidden = !connected
		$('session-actions').hidden = !connected
		if (!session) return
		const info = session.getSessionObj()
		$('session-app').textContent = `${info.displayName} (${info.appId})`
		$('session-id').textContent = info.sessionId
		$('session-player-state').textContent = player.isMediaLoaded ? player.playerState : 'IDLE'
		$('session-media').textContent = player.mediaInfo?.metadata?.title || '—'
	}

	context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, update)
	context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, update)
	controller.addEventListener(framework.RemotePlayerEventType.ANY_CHANGE, (event) => {
		// Skip the many time updates.
		if (event.field !== 'currentTime') update()
	})
	update()

	$('stop-casting').addEventListener('click', () => context.endCurrentSession(true))
	$('leave-session').addEventListener('click', () => context.endCurrentSession(false))
}
