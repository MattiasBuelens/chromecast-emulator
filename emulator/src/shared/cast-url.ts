/** Which other senders may join a session, and leave it along with a sender that leaves. */
export type AutoJoinPolicy = 'page_scoped' | 'tab_and_origin_scoped' | 'origin_scoped'

export interface CastUrl {
	appIds: string[]
	clientId: string
	autoJoinPolicy: AutoJoinPolicy
}

const AUTO_JOIN_POLICIES: readonly string[] = [
	'page_scoped',
	'tab_and_origin_scoped',
	'origin_scoped'
] satisfies AutoJoinPolicy[]

// Like Chrome, an unknown or missing policy means "page_scoped".
const toAutoJoinPolicy = (value: string | null | undefined): AutoJoinPolicy =>
	value && AUTO_JOIN_POLICIES.includes(value) ? (value as AutoJoinPolicy) : 'page_scoped'

// Like Chrome, name Cast presentations after their Cast session: "cast-session_<sessionId>".
// The receiver emulator uses the rest of the presentation ID as the session ID.
export const SESSION_ID_PREFIX = 'cast-session_'

/**
 * Parse a Cast presentation URL, in either of the forms Chrome accepts:
 * - `cast:<appId>?clientId=...&autoJoinPolicy=...`
 * - `https://google.com/cast#__castAppId__=<appId>/__castClientId__=...` (legacy)
 */
export const parseCastUrl = (presentationUrl: string): CastUrl | null => {
	const url = new URL(presentationUrl)
	if (url.protocol === 'cast:') {
		const appId = url.pathname
		if (!appId) return null
		return {
			appIds: [appId],
			clientId: url.searchParams.get('clientId') || '',
			autoJoinPolicy: toAutoJoinPolicy(url.searchParams.get('autoJoinPolicy'))
		}
	}
	if (/^https?:$/.test(url.protocol) && url.hostname === 'google.com' && url.pathname === '/cast') {
		const params = url.hash
			.slice(1)
			.split('/')
			.map((pair) => pair.split('='))
			.map(([key, value = '']) => [key, decodeURIComponent(value.replace(/\+/g, ' '))])
		const appIds = params
			.filter(([key]) => key === '__castAppId__')
			.map(([, value]) => value.replace(/\(.*$/, '')) // strip "(capabilities)"
			.filter(Boolean)
		const clientId = params.find(([key]) => key === '__castClientId__')?.[1] || ''
		const autoJoinPolicy = toAutoJoinPolicy(
			params.find(([key]) => key === '__castAutoJoinPolicy__')?.[1]
		)
		return appIds.length ? { appIds, clientId, autoJoinPolicy } : null
	}
	return null
}
