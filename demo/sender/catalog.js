/**
 * The videos in the library: Blender Foundation open movies, from Google's Cast sample media.
 *
 * @typedef {object} MediaItem
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} src Progressive MP4, playable locally and on the receiver
 * @property {string} contentType
 * @property {string} poster
 * @property {number} duration In seconds
 * @property {string} credit
 */

export const MEDIA_SOURCE_ROOT = 'https://storage.googleapis.com/cpe-sample-media/content/'

/**
 * @param {string} name The folder name in the sample media
 * @param {Omit<MediaItem, 'id' | 'src' | 'contentType' | 'poster'>} info
 * @param {number} screenshot Which screenshot to use as the poster
 * @returns {MediaItem}
 */
const item = (name, info, screenshot) => ({
	id: name,
	src: `${MEDIA_SOURCE_ROOT}${name}/prog/${name}_prog.mp4`,
	contentType: 'video/mp4',
	poster: `${MEDIA_SOURCE_ROOT}${name}/images/screenshot${screenshot}.png`,
	...info
})

/** @type {MediaItem[]} */
export const catalog = [
	item(
		'big_buck_bunny',
		{
			title: 'Big Buck Bunny',
			description: 'A giant rabbit takes on three bullying rodents.',
			duration: 596,
			credit: '© 2008 Blender Foundation, CC BY 3.0'
		},
		1
	),
	item(
		'elephants_dream',
		{
			title: 'Elephants Dream',
			description: 'Proog and Emo journey through the folds of a seemingly infinite machine.',
			duration: 653,
			credit: '© 2006 Blender Foundation, CC BY 2.5'
		},
		7
	),
	item(
		'sintel',
		{
			title: 'Sintel',
			description: 'A lonely young woman searches for the baby dragon she befriended.',
			duration: 887,
			credit: '© 2010 Blender Foundation, CC BY 3.0'
		},
		7
	),
	item(
		'tears_of_steel',
		{
			title: 'Tears of Steel',
			description: 'Soldiers and scientists in Amsterdam try to stop an army of robots.',
			duration: 734,
			credit: '© 2012 Blender Foundation, CC BY 3.0'
		},
		7
	)
]
