(function () {

const UE_VERSION = '1.0.0'
const UE_TAG = '[Universal Emotes]'
const UE_MSG = {
	NO_PROJECT: 'Open a project first',
	NO_ANIMATIONS: 'Create an animation first',
	NO_ANIMATION_SELECTED: 'Select an animation first',
	NO_MODELS_KEYFRAME: 'Select a Models keyframe first',
	UNSUPPORTED: 'Not supported by this Blockbench version'
}
const ueLog = {
	info: function () { try { console.log.apply(console, [UE_TAG].concat(Array.prototype.slice.call(arguments))) } catch (e) {} },
	warn: function () { try { console.warn.apply(console, [UE_TAG].concat(Array.prototype.slice.call(arguments))) } catch (e) {} },
	error: function () { try { console.error.apply(console, [UE_TAG].concat(Array.prototype.slice.call(arguments))) } catch (e) {} }
}
const ue_warned_keys = new Set()
function ueWarnOnce(key) {
	if (ue_warned_keys.has(key)) return
	ue_warned_keys.add(key)
	ueLog.warn.apply(null, Array.prototype.slice.call(arguments, 1))
}
function ueNotify(msg, duration) {
	try { if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) Blockbench.showQuickMessage(msg, duration || 1800) } catch (e) {}
}
function ueFail(userMsg, err) {
	if (err) ueLog.error(userMsg, err); else ueLog.error(userMsg)
	ueNotify(userMsg + (err && err.message ? ': ' + err.message : ''), 3000)
}
function ueRequireStore() {
	const s = (typeof Project !== 'undefined' && Project) ? getStore() : null
	if (!s) ueNotify(UE_MSG.NO_PROJECT)
	return s
}
function ueRequireAnimations() {
	if (!ueRequireStore()) return false
	if (typeof Animation === 'undefined' || !Animation.all || !Animation.all.length) { ueNotify(UE_MSG.NO_ANIMATIONS); return false }
	return true
}
function ueTime() { try { return (typeof Timeline !== 'undefined' && Timeline.time) ? Timeline.time : 0 } catch (e) { return 0 } }
function ueIsPlaying() { try { return !!(typeof Timeline !== 'undefined' && Timeline.playing) } catch (e) { return false } }
function ueSelectedKeyframes() { try { return (typeof Timeline !== 'undefined' && Timeline.selected) ? Timeline.selected : [] } catch (e) { return [] } }
function ueSelectedKeyframe(channel) {
	const sel = ueSelectedKeyframes()
	if (!channel) return sel[0] || null
	for (const kf of sel) if (kf && kf.channel === channel) return kf
	return null
}
function r4(v) { return Math.round(v * 10000) / 10000 }
function r4v(v) { return [r4(v[0]), r4(v[1]), r4(v[2])] }

let channel_added = false
let export_action, settings_action, toggle_preview_action, toggle_mode_action, anim_emote_action, new_model_action_r6, new_model_action_r15, edit_model_kf_action, preview_model_action
let original_geometry_cache = new WeakMap()
let bend_preview_enabled = true
let bend_smooth_mode = true

const BEND_PREVIEW_YAW_FIX_DEG = 180

function getStore() {
	if (!Project) return null
	let s = Project.universal_emotes
	if (!s || typeof s !== 'object') {
		s = {}
		Project.universal_emotes = s
	}
	if (!s.pack || typeof s.pack !== 'object') {
		s.pack = {
			min_mod_version: MOD_VERSIONS[0],
			rig_type: 'r6',
			namespace: 'universal_emotes',
			id: 'my_pack',
			title: 'My Emote Pack',
			author: (settings && settings.username ? settings.username.value : '') || 'author',
			version: '1.0.0',
			description: ''
		}
	}
	if (s.pack.rig_type !== 'r6' && s.pack.rig_type !== 'r15') s.pack.rig_type = 'r6'
	if (MOD_VERSIONS.indexOf(s.pack.min_mod_version) === -1) s.pack.min_mod_version = MOD_VERSIONS[0]
	if (s.preview_model !== 'wide' && s.preview_model !== 'thin') s.preview_model = 'wide'
	if (typeof s.icon_data_url === 'undefined') s.icon_data_url = null
	if (typeof s.assets_source_dir !== 'string') s.assets_source_dir = ''
	if (!Array.isArray(s.assets)) s.assets = []
	if (!s.emotes || typeof s.emotes !== 'object') s.emotes = {}
	return s
}

function emoteMeta(anim) {
	const store = getStore()
	if (!store) return null
	if (!store.emotes[anim.uuid]) {
		store.emotes[anim.uuid] = {
			id: slugifyBase(emoteDisplayName(anim.name) || 'emote'),
			name: emoteDisplayName(anim.name) || 'Emote',
			description: '',
			op: 0,
			rarity: 'common'
		}
	}
	return store.emotes[anim.uuid]
}

function emoteAnimationId(anim) {
	const n = String((anim && anim.name) || 'emote')
	return n.startsWith('animation.') ? n : ('animation.' + n)
}

function emoteDisplayName(n) {
	return String(n || '').replace(/^animation\./, '')
}

const MOD_VERSIONS = [
	'1.0.0-beta.1'
]

const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'complementary']

function isR15() {
	try { const s = getStore(); return !!(s && s.pack && s.pack.rig_type === 'r15') } catch (e) { return false }
}

function addBendChannel() {
	if (channel_added) return
	if (typeof BoneAnimator === 'undefined' || !BoneAnimator.addChannel) {
		ueLog.warn('BoneAnimator.addChannel not found - Bend channel needs Blockbench 4.9+')
		return
	}

	BoneAnimator.addChannel('bend', {
		name: 'Bend',
		condition: function () { return !isR15() },
		mutable: true,
		transform: true,
		max_data_points: 2,
		displayFrame: function (animator ) {
			if (!animator.group || !animator.group.mesh) return
			try {
				applyBendToGroup(animator)
			} catch (e) {
				ueWarnOnce('bend_preview', 'bend preview error:', e)
				try { restoreGroupGeometry(animator.group) } catch (e2) {}
			}
		}
	})
	channel_added = true
}

function readBendKeyframe(animator) {
	let res = false
	try { res = animator.interpolate ? animator.interpolate('bend', false) : false } catch (e) { res = false }
	if (res === false || res == null) return null
	let value = Array.isArray(res) ? Number(res[0]) : Number(res)
	let axis = Array.isArray(res) ? Number(res[1] || 0) : 0
	if (!isFinite(value)) value = 0
	if (!isFinite(axis)) axis = 0
	return { value: value, axis: axis }
}

function collectGroupCubes(group) {
	const out = []
	if (!group || !group.children) return out
	for (const c of group.children) {
		if (typeof Cube !== 'undefined' && c instanceof Cube && c.mesh && c.mesh.geometry) {
			out.push(c.mesh)
		}
	}
	return out
}

function restoreGroupGeometry(group) {
	for (const m of collectGroupCubes(group)) restoreGeometry(m)
}

function restoreGeometry(m) {
	const rec = original_geometry_cache.get(m)
	if (rec && rec.orig && m.geometry !== rec.orig) m.geometry = rec.orig
}

function isBendContextActive() {
	if (!ueInAnimateMode()) return false
	try { return !!(typeof Animation !== 'undefined' && Animation.selected) } catch (e) { return false }
}

function restoreAllBendGeometry() {
	let changed = false
	try {
		if (typeof Group !== 'undefined' && Group.all) {
			Group.all.forEach(function (g) {
				collectGroupCubes(g).forEach(function (m) {
					const rec = original_geometry_cache.get(m)
					if (rec && rec.orig && rec.work && m.geometry === rec.work) {
						m.geometry = rec.orig
						changed = true
					}
				})
			})
		}
	} catch (e) {}
	if (changed && typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll()
	return changed
}

let bend_watchdog_id = null
function startBendWatchdog() {
	if (bend_watchdog_id !== null) return
	if (typeof requestAnimationFrame !== 'function') return
	function tick() {
		if (bend_watchdog_id === null) return
		try { if (!isBendContextActive()) restoreAllBendGeometry() } catch (e) {}
		bend_watchdog_id = requestAnimationFrame(tick)
	}
	bend_watchdog_id = requestAnimationFrame(tick)
}
function stopBendWatchdog() {
	if (bend_watchdog_id !== null) {
		try { cancelAnimationFrame(bend_watchdog_id) } catch (e) {}
		bend_watchdog_id = null
	}
}

function onBendContextChange() {
	if (!isBendContextActive()) { try { ueApplyArmModel(ueInAnimateMode() ? null : 'wide') } catch (e) {} restoreAllBendGeometry() }
}

function applyBendToGroup(animator) {
	const group = animator.group
	const meshes = collectGroupCubes(group)
	if (!meshes.length) return
	if (ue_skin_swap_until && ueNow() < ue_skin_swap_until) { for (const m of meshes) restoreGeometry(m); return }
	if (isR15()) { for (const m of meshes) restoreGeometry(m); return }
	if (!bend_preview_enabled || !isBendContextActive()) { for (const m of meshes) restoreGeometry(m); return }
	const bend = readBendKeyframe(animator)
	if (!bend || Math.abs(bend.value) < 1e-4) {
		for (const m of meshes) restoreGeometry(m)
		return
	}
	if (bend_smooth_mode) bendGroupGeometrySmooth(meshes, bend.value * Math.PI / 180, bend.axis || 0)
	else bendGroupGeometry(meshes, bend.value * Math.PI / 180, bend.axis || 0)
}

function meshToGroupTris(m, geom) {
	const pos = geom.attributes.position
	const uvAttr = geom.attributes.uv
	const idx = geom.index
	const q = m.quaternion, px = m.position.x, py = m.position.y, pz = m.position.z
	const v3 = new THREE.Vector3()
	function vert(i) {
		v3.set(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyQuaternion(q)
		return {
			x: v3.x + px, y: v3.y + py, z: v3.z + pz,
			u: uvAttr ? uvAttr.array[i * 2] : 0,
			v: uvAttr ? uvAttr.array[i * 2 + 1] : 0
		}
	}
	const tris = []
	if (idx) {
		const a = idx.array
		for (let i = 0; i < a.length; i += 3) tris.push([vert(a[i]), vert(a[i + 1]), vert(a[i + 2])])
	} else {
		for (let i = 0; i < pos.count; i += 3) tris.push([vert(i), vert(i + 1), vert(i + 2)])
	}
	return tris
}

function lerpVert(a, b, t) {
	return {
		x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
		u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t
	}
}

function sliceTrisByY(tris, c) {
	const EPS = 1e-6
	const out = []
	for (const t of tris) {
		const d = [t[0].y - c, t[1].y - c, t[2].y - c]
		let nPos = 0, nNeg = 0
		for (const dd of d) { if (dd > EPS) nPos++; else if (dd < -EPS) nNeg++ }
		if (nPos === 0 || nNeg === 0) { out.push(t); continue }
		const above = [], below = []
		for (let i = 0; i < 3; i++) {
			const cur = t[i], nxt = t[(i + 1) % 3]
			const dc = d[i], dn = d[(i + 1) % 3]
			if (dc >= 0) above.push(cur); else below.push(cur)
			if ((dc > 0 && dn < 0) || (dc < 0 && dn > 0)) {
				const tt = dc / (dc - dn)
				const ip = lerpVert(cur, nxt, tt)
				above.push(ip); below.push(ip)
			}
		}
		for (const poly of [above, below]) {
			for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]])
		}
	}
	return out
}

function buildSubdiv(m, origGeom, cutYs) {
	let tris = meshToGroupTris(m, origGeom)
	for (const c of cutYs) tris = sliceTrisByY(tris, c)
	const n = tris.length * 3
	const groupRest = new Float32Array(n * 3)
	const uv = new Float32Array(n * 2)
	let vi = 0
	for (const t of tris) {
		for (const p of t) {
			groupRest[vi * 3] = p.x; groupRest[vi * 3 + 1] = p.y; groupRest[vi * 3 + 2] = p.z
			uv[vi * 2] = p.u; uv[vi * 2 + 1] = p.v
			vi++
		}
	}
	const work = new THREE.BufferGeometry()
	work.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
	work.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
	if (Array.isArray(m.material)) work.addGroup(0, n, 0)

	const __origHl = (origGeom && origGeom.attributes && origGeom.attributes.highlight) ? origGeom.attributes.highlight.array : null
	const __hlArr = __origHl ? new __origHl.constructor(n) : new Uint8Array(n)
	work.setAttribute('highlight', new THREE.BufferAttribute(__hlArr, 1))
	let __faceKey = 'north'
	try {
		const __el = (typeof OutlinerNode !== 'undefined') && m && OutlinerNode.uuids[m.name]
		if (__el && __el.faces) {
			const __ks = Object.keys(__el.faces)
			if (__ks.length) __faceKey = __ks[0]
		}
	} catch (e) {}
	work.faces = new Array(tris.length).fill(__faceKey)
	return { orig: origGeom, work: work, groupRest: groupRest, uv: uv, count: n, built: true }
}

function ensureRecord(m, cutYs) {
	let rec = original_geometry_cache.get(m)
	if (rec && rec.built) return rec
	rec = buildSubdiv(m, m.geometry, cutYs)
	original_geometry_cache.set(m, rec)
	return rec
}

function bendGroupGeometry(meshes, valueRad, axisDeg) {
	const theta = valueRad
	if (Math.abs(theta) < 1e-5) return
	const axisRad = ((axisDeg || 0) + BEND_PREVIEW_YAW_FIX_DEG) * Math.PI / 180

	const axx = Math.cos(axisRad), axy = 0, axz = Math.sin(axisRad)

	const Dx = 0, Dy = 1, Dz = 0
	const bl = false

	const v3 = new THREE.Vector3()
	let minY = Infinity, maxY = -Infinity
	let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
	for (const m of meshes) {
		const rec0 = original_geometry_cache.get(m)
		const src = rec0 && rec0.orig ? rec0.orig : m.geometry
		const pos = src.attributes.position
		const q = m.quaternion, px = m.position.x, py = m.position.y, pz = m.position.z
		for (let i = 0; i < pos.count; i++) {
			v3.set(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyQuaternion(q)
			const x = v3.x + px, y = v3.y + py, z = v3.z + pz
			if (y < minY) minY = y
			if (y > maxY) maxY = y
			if (x < minX) minX = x
			if (x > maxX) maxX = x
			if (z < minZ) minZ = z
			if (z > maxZ) maxZ = z
		}
	}
	const L = maxY - minY
	if (!(L > 1e-6)) return

	const cX = (minX + maxX) / 2, cY = (minY + maxY) / 2, cZ = (minZ + maxZ) / 2
	const halfSize = L / 2

	const freeEndY = (Math.abs(minY) >= Math.abs(maxY)) ? minY : maxY
	const nearEndY = (freeEndY === minY) ? maxY : minY

	const baseNormDist = -(Dy * freeEndY)
	const otherNormDist = -(Dy * nearEndY)

	let bnx = Dy * axz - Dz * axy
	let bny = Dz * axx - Dx * axz
	let bnz = Dx * axy - Dy * axx
	const bnLen = Math.hypot(bnx, bny, bnz) || 1
	bnx /= bnLen; bny /= bnLen; bnz /= bnLen
	const bendNormDist = -(bnx * cX + bny * cY + bnz * cZ)

	const rotQ = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(axx, axy, axz).normalize(), theta
	)
	const tanHalf = Math.tan(theta / 2)

	const N = Math.max(8, Math.min(24, Math.round(L)))
	const cutYs = []
	for (let k = 1; k < N; k++) cutYs.push(minY + L * k / N)

	const invQ = new THREE.Quaternion()
	const p = new THREE.Vector3()
	for (const m of meshes) {
		const rec = ensureRecord(m, cutYs)
		invQ.copy(m.quaternion).invert()
		const gr = rec.groupRest
		const outArr = rec.work.attributes.position.array
		for (let i = 0; i < gr.length; i += 3) {
			const gx = gr[i], gy = gr[i + 1], gz = gr[i + 2]
			let distFromBend = bnx * gx + bny * gy + bnz * gz + bendNormDist
			if (bl) distFromBend = -distFromBend
			const distFromBase = Dy * gy + baseNormDist
			const distFromOther = Dy * gy + otherNormDist
			const s = tanHalf * distFromBend
			let nx, ny, nz
			if (Math.abs(distFromBase) < Math.abs(distFromOther)) {
				const f = -distFromBase / halfSize * s
				nx = gx + Dx * f; ny = gy + Dy * f; nz = gz + Dz * f
				p.set(nx - cX, ny - cY, nz - cZ).applyQuaternion(rotQ)
				nx = p.x + cX; ny = p.y + cY; nz = p.z + cZ
			} else {
				const f = -distFromOther / halfSize * s
				nx = gx + Dx * f; ny = gy + Dy * f; nz = gz + Dz * f
			}
			p.set(nx - m.position.x, ny - m.position.y, nz - m.position.z).applyQuaternion(invQ)
			outArr[i] = p.x; outArr[i + 1] = p.y; outArr[i + 2] = p.z
		}
		rec.work.attributes.position.needsUpdate = true
		rec.work.computeVertexNormals()
		if (m.geometry !== rec.work) m.geometry = rec.work
	}
}

function bendGroupGeometrySmooth(meshes, valueRad, axisDeg) {
	const theta = valueRad
	if (Math.abs(theta) < 1e-5) return
	const axisRad = ((axisDeg || 0) + BEND_PREVIEW_YAW_FIX_DEG) * Math.PI / 180
	const A = new THREE.Vector3(Math.cos(axisRad), 0, Math.sin(axisRad)).normalize()
	const v3 = new THREE.Vector3()
	let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
	for (const m of meshes) {
		const rec0 = original_geometry_cache.get(m)
		const src = rec0 && rec0.orig ? rec0.orig : m.geometry
		const pos = src.attributes.position
		const q0 = m.quaternion, px = m.position.x, py = m.position.y, pz = m.position.z
		for (let i = 0; i < pos.count; i++) {
			v3.set(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyQuaternion(q0)
			const x = v3.x + px, y = v3.y + py, z = v3.z + pz
			if (y < minY) minY = y
			if (y > maxY) maxY = y
			if (x < minX) minX = x
			if (x > maxX) maxX = x
			if (z < minZ) minZ = z
			if (z > maxZ) maxZ = z
		}
	}
	const L = maxY - minY
	if (!(L > 1e-6)) return
	const cX = (minX + maxX) / 2, cZ = (minZ + maxZ) / 2
	const freeEndY = (Math.abs(minY) >= Math.abs(maxY)) ? minY : maxY
	const nearEndY = (freeEndY === minY) ? maxY : minY
	const span = freeEndY - nearEndY
	const sign = span > 0 ? 1 : -1
	const W = 0.28
	function S(t) { let u = (t - (0.5 - W)) / (2 * W); if (u < 0) u = 0; else if (u > 1) u = 1; return u * u * (3 - 2 * u) }
	function phi(y) { let t = (y - nearEndY) / span; if (t < 0) t = 0; else if (t > 1) t = 1; return theta * S(t) }

	const M = 2000
	const sampleC = new Float64Array((M + 1) * 3)
	let Cx = cX, Cy = nearEndY, Cz = cZ
	sampleC[0] = Cx; sampleC[1] = Cy; sampleC[2] = Cz
	const dy = span / M, adyy = Math.abs(dy)
	const tv = new THREE.Vector3(), tq = new THREE.Quaternion()
	for (let i = 0; i < M; i++) {
		const ymid = nearEndY + dy * (i + 0.5)
		tq.setFromAxisAngle(A, phi(ymid))
		tv.set(0, sign, 0).applyQuaternion(tq)
		Cx += tv.x * adyy; Cy += tv.y * adyy; Cz += tv.z * adyy
		sampleC[(i + 1) * 3] = Cx; sampleC[(i + 1) * 3 + 1] = Cy; sampleC[(i + 1) * 3 + 2] = Cz
	}
	function Cat(y, out) {
		let f = (y - nearEndY) / span * M
		if (f < 0) f = 0; else if (f > M) f = M
		const i0 = Math.floor(f), fr = f - i0, i1 = Math.min(i0 + 1, M)
		out[0] = sampleC[i0 * 3] + (sampleC[i1 * 3] - sampleC[i0 * 3]) * fr
		out[1] = sampleC[i0 * 3 + 1] + (sampleC[i1 * 3 + 1] - sampleC[i0 * 3 + 1]) * fr
		out[2] = sampleC[i0 * 3 + 2] + (sampleC[i1 * 3 + 2] - sampleC[i0 * 3 + 2]) * fr
	}
	const N = Math.max(16, Math.min(48, Math.round(L * 2)))
	const cutYs = []
	for (let k = 1; k < N; k++) cutYs.push(minY + L * k / N)
	const invQ = new THREE.Quaternion(), p = new THREE.Vector3(), loff = new THREE.Vector3(), vq = new THREE.Quaternion()
	const C = [0, 0, 0]
	for (const m of meshes) {
		const rec = ensureRecord(m, cutYs)
		invQ.copy(m.quaternion).invert()
		const gr = rec.groupRest
		const outArr = rec.work.attributes.position.array
		for (let i = 0; i < gr.length; i += 3) {
			const gx = gr[i], gy = gr[i + 1], gz = gr[i + 2]
			const a = phi(gy)
			vq.setFromAxisAngle(A, a)
			loff.set(gx - cX, 0, gz - cZ).applyQuaternion(vq)
			Cat(gy, C)
			const nx = C[0] + loff.x, ny = C[1] + loff.y, nz = C[2] + loff.z
			p.set(nx - m.position.x, ny - m.position.y, nz - m.position.z).applyQuaternion(invQ)
			outArr[i] = p.x; outArr[i + 1] = p.y; outArr[i + 2] = p.z
		}
		rec.work.attributes.position.needsUpdate = true
		rec.work.computeVertexNormals()
		if (m.geometry !== rec.work) m.geometry = rec.work
	}
}

function extractEvents(anim) {
	const events = []
	const ea = anim.animators && anim.animators.effects
	if (!ea) return events

	if (ea.particle) for (const kf of ea.particle) {
		const dp = kf.data_points && kf.data_points[0] || {}
		const tf = readEffectTransform(kf, dp)
		events.push(cleanEvent({
			time: round(kf.time),
			type: 'spawn_particle',
			asset_id: dp.effect || dp.particle || '',
			bone: dp.locator || undefined,
			pos: tf.pos,
			rot: tf.rot
		}))
	}

	if (ea.sound) for (const kf of ea.sound) {
		const dp = kf.data_points && kf.data_points[0] || {}
		const vp = readSoundParams(kf, dp)
		const music = ueSoundType(kf, dp) === 'music'
		events.push(cleanEvent({
			time: round(kf.time),
			type: music ? 'play_music' : 'play_sound',
			asset_id: dp.effect || dp.sound || '',
			volume: vp.volume,
			pitch: music ? undefined : vp.pitch,
			dmca: ueDmcaValue(dp.ue_dmca)
		}))
	}

	if (ea.models) {
		const coll = ueCollectModelEntries(ea)
		for (const s of coll.singles) {
			const m = s.m
			events.push(cleanEvent({
				time: round(s.time),
				type: 'render_model',
				asset_id: m.asset_id,
				texture: m.texture,
				attach_mode: m.attach_mode,
				bone: m.bone,
				pos: m.pos,
				rot: m.rot,
				scale: m.scale,
				end: m.end
			}))
		}
		for (const id in coll.tracks) {
			const wps = coll.tracks[id]
			if (!wps.length) continue
			const first = wps[0].m
			const endT = ueTrackEnd(wps)
			const ev = {
				time: round(wps[0].time),
				type: 'render_model',
				asset_id: first.asset_id,
				texture: first.texture,
				attach_mode: first.attach_mode,
				bone: first.bone,
				pos: first.pos,
				rot: first.rot,
				scale: first.scale,
				end: isFinite(endT) ? round(endT) : undefined
			}
			if (wps.length > 1) {
				ev.keyframes = wps.map(function (w) {
					return {
						time: round(w.time),
						pos: w.m.pos || [0, 0, 0],
						rot: w.m.rot || [0, 0, 0],
						scale: (w.m.scale != null) ? w.m.scale : 1,
						lerp_mode: mapLerpMode(w.kf)
					}
				})
			}
			events.push(cleanEvent(ev))
		}
	}

	if (ea.timeline) for (const kf of ea.timeline) {
		const dp = kf.data_points && kf.data_points[0] || {}
		const script = dp.script || dp.instructions || ''
		String(script).split(/\r?\n/).forEach(line => {
			const ev = parseInstruction(line, round(kf.time))
			if (ev) events.push(ev)
		})
	}
	events.sort((a, b) => a.time - b.time)
	return events
}

function parseInstruction(line, time) {
	line = (line || '').trim()
	if (!line || line.startsWith('#') || line.startsWith('//')) return null

	let parts = line.includes(' ') ? line.split(/\s+/) : line.split(':')

	let type = parts.shift()
	const ev = { time: time, type: type }
	switch (type) {
		case 'play_music':
		case 'play_sound': {
			for (let i = 0; i < parts.length; i++) {
				const m = /^dmca(?:=(.*))?$/i.exec(parts[i])
				if (m) { ev.dmca = ueDmcaValue(m[1] == null ? 'true' : m[1]); parts.splice(i, 1); break }
			}
			ev.asset_id = rejoinAsset(parts, line)
			const vol = lastNumber(parts)
			ev.volume = vol != null ? vol : 1.0
			break
		}
		case 'spawn_particle': {
			ev.bone = parts.shift()
			ev.asset_id = rejoinAsset(parts, line)
			const amt = lastNumber(parts)
			if (amt != null) ev.amount = amt
			break
		}
		case 'set_skin': {
			parts = parts.filter(function (p) { return p !== 'auto' && p !== 'manual' })
			ev.model = extractSkinModel(parts)
			ev.asset_id = rejoinAsset(parts, line)
			break
		}
		case 'reset_skin':
			break
		default:
			return null
	}
	return cleanEvent(ev)
}

function rejoinAsset(parts, original) {

	for (let i = 0; i < parts.length; i++) {
		if (isNaN(Number(parts[i]))) {
			const asset = parts[i]
			parts.splice(i, 1)
			return asset
		}
	}
	return ''
}
function extractSkinModel(parts) {
	for (let i = 0; i < parts.length; i++) {
		const t = String(parts[i]).toLowerCase()
		if (t === 'thin' || t === 'slim' || t === 'alex') { parts.splice(i, 1); return 'thin' }
		if (t === 'wide' || t === 'classic' || t === 'steve') { parts.splice(i, 1); return 'wide' }
		if (t === 'default') { parts.splice(i, 1); return 'default' }
	}
	return undefined
}
function lastNumber(parts) {
	for (let i = parts.length - 1; i >= 0; i--) {
		const n = Number(parts[i])
		if (!isNaN(n)) { parts.splice(i, 1); return n }
	}
	return null
}
function ueDmcaValue(raw) {
	if (raw == null) return undefined
	const t = String(raw).trim()
	if (!t || /^(false|no|0|off)$/i.test(t)) return undefined
	if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(t)) return t
	return true
}
function cleanEvent(ev) {
	Object.keys(ev).forEach(k => { if (ev[k] === undefined || ev[k] === '') delete ev[k] })
	return ev
}
function round(v) { return Math.round(v * 1000) / 1000 }

let models_channel_added = false
let ue_sound_hook_installed = false
let ue_last_play_time = -1
let ue_played_marks = {}
let ue_active_audio = []
let ue_was_playing = false
let ue_particle_markers = {}
let ue_kf_observer = null
let ue_kf_refresh_raf = 0

function numOr(v, d) { const n = Number(v); return isFinite(n) ? r4(n) : d }
function parseVec3(s, d) {
	if (s == null || s === '') return d
	const p = String(s).split(',').map(function (x) { return Number(x.trim()) })
	if (p.length < 3 || p.some(function (x) { return !isFinite(x) })) return d
	return [numOr(p[0], 0), numOr(p[1], 0), numOr(p[2], 0)]
}
function parseModelField(raw) {
	if (!raw) return null
	const f = String(raw).split('|').map(function (x) { return x.trim() })
	return {
		asset_id: f[0] || '',
		attach_mode: (['bone', 'model_root', 'world'].indexOf(f[1]) !== -1) ? f[1] : 'bone',
		bone: f[2] || undefined,
		pos: parseVec3(f[3], undefined),
		rot: parseVec3(f[4], undefined),
		scale: (f[5] != null && f[5] !== '') ? numOr(f[5], 1) : undefined,
		end: (f[6] != null && f[6] !== '') ? numOr(f[6], undefined) : undefined,
		texture: f[7] || undefined,
		track: f[8] || undefined
	}
}
function encodeModelField(m) {
	m = m || {}
	const pos = Array.isArray(m.pos) ? m.pos.join(',') : ''
	const rot = Array.isArray(m.rot) ? m.rot.join(',') : ''
	const base = [m.asset_id || '', m.attach_mode || 'bone', m.bone || '', pos, rot, (m.scale != null ? m.scale : ''), (m.end != null ? m.end : ''), (m.texture || '')].join(' | ')
	return m.track ? (base + ' | ' + m.track) : base
}
function ueNewTrackId() { return 't' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3) }
function ueDpModel(dp) { return parseModelField(dp && (dp.model || dp.script || dp.effect) || '') }
function ueWriteDpModel(dp, m) { const enc = encodeModelField(m); dp.model = enc; dp.script = enc; return enc }

function ueCollectModelEntries(ea) {
	const out = { singles: [], tracks: {} }
	const list = (ea && ea.models) ? ea.models : []
	for (const kf of list) {
		const dps = (kf.data_points && kf.data_points.length) ? kf.data_points : []
		dps.forEach(function (dp, di) {
			const m = ueDpModel(dp)
			if (!m || !m.asset_id) return
			const e = { kf: kf, di: di, dp: dp, m: m, time: round(kf.time) }
			if (m.track) (out.tracks[m.track] = out.tracks[m.track] || []).push(e)
			else out.singles.push(e)
		})
	}
	for (const id in out.tracks) out.tracks[id].sort(function (a, b) { return a.time - b.time })
	return out
}
function ueTrackEnd(wps) {
	if (!wps || !wps.length) return Infinity
	const lastT = wps[wps.length - 1].time
	let best = -Infinity
	for (const w of wps) {
		const e = w.m.end
		if (e != null && isFinite(e) && e >= lastT - 1e-6 && e > best) best = e
	}
	return best === -Infinity ? Infinity : best
}
function ueVec(v, d) { return (Array.isArray(v) && v.length >= 3) ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] : d.slice() }
function ueCatmull(p0, p1, p2, p3, t) {
	const t2 = t * t, t3 = t2 * t
	return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}
function ueEvalTrack(wps, t) {
	const Z = [0, 0, 0]
	function st(w) { return { pos: ueVec(w.m.pos, Z), rot: ueVec(w.m.rot, Z), scale: (w.m.scale != null && isFinite(w.m.scale)) ? w.m.scale : 1 } }
	if (!wps.length) return null
	if (wps.length === 1 || t <= wps[0].time) { const s = st(wps[0]); s.base = wps[0].m; s.seg = 0; return s }
	const last = wps[wps.length - 1]
	if (t >= last.time) { const s = st(last); s.base = last.m; s.seg = wps.length - 1; return s }
	let i = 0
	while (i < wps.length - 2 && wps[i + 1].time <= t) i++
	const a = wps[i], b = wps[i + 1]
	const A = st(a), B = st(b)
	const span = b.time - a.time
	const alpha = span > 1e-9 ? Math.min(1, Math.max(0, (t - a.time) / span)) : 1
	const mode = mapLerpMode(a.kf)
	let res
	if (mode === 'step') {
		res = A
	} else if (mode === 'catmullrom') {
		const P = wps[i - 1] ? st(wps[i - 1]) : A
		const N = wps[i + 2] ? st(wps[i + 2]) : B
		const cv = function (k, j) { return ueCatmull(P[k][j], A[k][j], B[k][j], N[k][j], alpha) }
		res = {
			pos: [cv('pos', 0), cv('pos', 1), cv('pos', 2)],
			rot: [cv('rot', 0), cv('rot', 1), cv('rot', 2)],
			scale: ueCatmull(P.scale, A.scale, B.scale, N.scale, alpha)
		}
	} else {
		const lv = function (x, y) { return x + (y - x) * alpha }
		res = {
			pos: [lv(A.pos[0], B.pos[0]), lv(A.pos[1], B.pos[1]), lv(A.pos[2], B.pos[2])],
			rot: [lv(A.rot[0], B.rot[0]), lv(A.rot[1], B.rot[1]), lv(A.rot[2], B.rot[2])],
			scale: lv(A.scale, B.scale)
		}
	}
	res.base = a.m; res.seg = i
	return res
}

function ueFindPrevModelsKf(animator, time) {
	const list = (animator && animator.models) ? animator.models : []
	let best = null
	const t = (typeof Timeline !== 'undefined' && Timeline.snapTime) ? Timeline.snapTime(time) : time
	for (const kf of list) {
		if (kf.time < t - 1e-4 && (!best || kf.time > best.time)) best = kf
	}
	if (!best) return null
	const has = (best.data_points || []).some(function (dp) { const m = ueDpModel(dp); return m && m.asset_id })
	return has ? best : null
}
function ueNewDataPoint(kf) {
	try { if (typeof KeyframeDataPoint !== 'undefined') return new KeyframeDataPoint(kf) } catch (e) {}
	return {}
}
function ueFillModelsFromPrevious(kf, prev, animator) {
	const coll = ueCollectModelEntries(animator)
	const src = prev.data_points || []
	let di = 0
	src.forEach(function (sdp) {
		const m = ueDpModel(sdp)
		if (!m || !m.asset_id) return
		if (!m.track) { m.track = ueNewTrackId(); ueWriteDpModel(sdp, m) }
		const copy = Object.assign({}, m)
		const wps = coll.tracks[m.track]
		if (wps && wps.length) {
			const s = ueEvalTrack(wps, kf.time)
			if (s) { copy.pos = r4v(s.pos); copy.rot = r4v(s.rot); copy.scale = r4(s.scale) }
		}
		if (copy.end != null && isFinite(copy.end) && copy.end <= kf.time + 1e-6) copy.end = undefined
		if (!kf.data_points[di]) kf.data_points.push(ueNewDataPoint(kf))
		ueWriteDpModel(kf.data_points[di], copy)
		di++
	})
	if (di && kf.data_points.length > di) kf.data_points.splice(di)
	return di
}
let ue_ck_installed = false, ue_ck_own = false, ue_ck_prev = null
function ueInstallCreateKeyframeHook() {
	if (ue_ck_installed) return
	try {
		if (typeof EffectAnimator === 'undefined' || !EffectAnimator.prototype || typeof EffectAnimator.prototype.createKeyframe !== 'function') return
		const proto = EffectAnimator.prototype
		ue_ck_own = Object.prototype.hasOwnProperty.call(proto, 'createKeyframe')
		ue_ck_prev = proto.createKeyframe
		const orig = ue_ck_prev
		proto.createKeyframe = function (value, time, channel, undo, select) {
			if (channel !== 'models' || value) return orig.apply(this, arguments)
			let prev = null
			try { prev = ueFindPrevModelsKf(this, (typeof time === 'number') ? time : ueTime()) } catch (e) {}
			if (!prev) return orig.apply(this, arguments)
			const kfs = [prev]
			const useUndo = !!(undo && typeof Undo !== 'undefined')
			if (useUndo) Undo.initEdit({ keyframes: kfs })
			const kf = orig.call(this, value, time, channel, false, select)
			try { if (kf && kf !== prev) { ueFillModelsFromPrevious(kf, prev, this); kfs.push(kf) } } catch (e) { ueLog.warn('linking new Models keyframe failed:', e) }
			if (useUndo) Undo.finishEdit('Add keyframe', { keyframes: kfs })
			try { ueRebuildKfFields() } catch (e) {}
			return kf
		}
		ue_ck_installed = true
	} catch (e) { ueLog.warn('createKeyframe hook failed:', e) }
}
function ueUninstallCreateKeyframeHook() {
	try {
		if (!ue_ck_installed) return
		const proto = EffectAnimator.prototype
		if (ue_ck_own) proto.createKeyframe = ue_ck_prev
		else delete proto.createKeyframe
	} catch (e) {}
	ue_ck_installed = false; ue_ck_prev = null
}

let ue_dp_props = []
function ueRegisterDataPointProps() {
	if (ue_dp_props.length || typeof Property === 'undefined' || typeof KeyframeDataPoint === 'undefined') return
	const ch = function (names) { return function (p) { try { return !!(p && p.keyframe && names.indexOf(p.keyframe.channel) !== -1) } catch (e) { return false } } }
	const defs = [
		['string', 'model', ch(['models']), undefined],
		['string', 'ue_pos', ch(['particle']), undefined],
		['string', 'ue_rot', ch(['particle']), undefined],
		['number', 'ue_volume', ch(['sound']), 1],
		['number', 'ue_pitch', ch(['sound']), 1],
		['string', 'ue_dmca', ch(['sound']), undefined],
		['string', 'ue_sound_type', ch(['sound']), 'sound']
	]
	defs.forEach(function (d) {
		try {
			if (KeyframeDataPoint.properties && KeyframeDataPoint.properties[d[1]]) return
			const opts = { exposed: false, condition: d[2] }
			if (d[3] !== undefined) opts.default = d[3]
			ue_dp_props.push(new Property(KeyframeDataPoint, d[0], d[1], opts))
		} catch (e) { ueLog.warn('property register failed:', d[1], e) }
	})
}
function ueUnregisterDataPointProps() {
	ue_dp_props.forEach(function (p) { try { if (p && p.delete) p.delete() } catch (e) {} })
	ue_dp_props = []
}
function readEffectTransform(kf, dp) {
	const out = { pos: undefined, rot: undefined }
	try {
		const ps = (dp && dp.ue_pos) || (kf && kf.ue_pos)
		const rs = (dp && dp.ue_rot) || (kf && kf.ue_rot)
		if (ps) out.pos = parseVec3(ps, undefined)
		if (rs) out.rot = parseVec3(rs, undefined)
	} catch (e) {}
	return out
}
function ueSoundType(kf, dp) {
	const t = String((dp && dp.ue_sound_type) || (kf && kf.ue_sound_type) || 'sound').toLowerCase()
	return t === 'music' ? 'music' : 'sound'
}
function readSoundParams(kf, dp) {
	let volume = 1.0, pitch = 1.0
	try {
		const v = (dp && dp.ue_volume != null && dp.ue_volume !== '') ? dp.ue_volume : (kf && kf.ue_volume)
		const p = (dp && dp.ue_pitch != null && dp.ue_pitch !== '') ? dp.ue_pitch : (kf && kf.ue_pitch)
		if (v != null && v !== '') volume = numOr(v, 1.0)
		if (p != null && p !== '') pitch = numOr(p, 1.0)
	} catch (e) {}
	return { volume: volume, pitch: pitch }
}

function addModelsEffectChannel() {
	if (models_channel_added) return
	try {
		if (typeof EffectAnimator === 'undefined') return
		const proto = EffectAnimator.prototype
		if (proto && proto.channels && proto.channels.models) { models_channel_added = true; return }
		if (typeof EffectAnimator.addChannel === 'function') {
			EffectAnimator.addChannel('models', { name: 'Models', mutable: true, max_data_points: 256 })
			models_channel_added = true
			return
		}
		if (proto && proto.channels) {
			proto.channels.models = { name: 'Models', mutable: true, max_data_points: 256 }
			models_channel_added = true
		}
	} catch (e) { ueLog.warn('Models channel unavailable:', e) }
}
function removeModelsEffectChannel() {
	try {
		const proto = (typeof EffectAnimator !== 'undefined') ? EffectAnimator.prototype : null
		if (proto && proto.channels && proto.channels.models) delete proto.channels.models
	} catch (e) {}
	models_channel_added = false
}
function selectedModelsKeyframe() { return ueSelectedKeyframe('models') }
function ueEditKeyframes(kfs, label, fn) {
	const useUndo = typeof Undo !== 'undefined' && !Undo.current_save
	if (useUndo) Undo.initEdit({ keyframes: kfs.slice() })
	try { fn() } catch (e) { if (useUndo) { try { Undo.cancelEdit(true) } catch (e2) {} } throw e }
	if (useUndo) Undo.finishEdit(label, { keyframes: kfs.slice() })
	markProjectDirty()
}
function ueParseEnd(v) { const t = String(v == null ? '' : v).trim(); return (t !== '' && isFinite(Number(t))) ? Number(t) : undefined }
function ueModelFromValues(v, track) {
	return {
		asset_id: String(v.asset_id || '').trim(),
		texture: String(v.texture || '').trim(),
		attach_mode: v.attach_mode || 'bone',
		bone: String(v.bone || '').trim(),
		pos: [numOr(v.px, 0), numOr(v.py, 0), numOr(v.pz, 0)],
		rot: [numOr(v.rx, 0), numOr(v.ry, 0), numOr(v.rz, 0)],
		scale: numOr(v.scale, 1),
		end: ueParseEnd(v.end),
		track: track
	}
}
function openModelKeyframeDialog(index) {
	const kf = selectedModelsKeyframe()
	if (!kf) { ueNotify(UE_MSG.NO_MODELS_KEYFRAME); return }
	if (!kf.data_points || !kf.data_points.length) kf.data_points = [ueNewDataPoint(kf)]
	if (index == null && kf.data_points.length > 1) {
		const opts = {}
		kf.data_points.forEach(function (dp, i) { const m = ueDpModel(dp) || {}; opts[i] = '#' + (i + 1) + '  ' + (m.asset_id || '(empty)') })
		new Dialog({
			id: 'universal_emotes_model_kf_pick', title: 'Model Event',
			form: { index: { label: 'Model', type: 'select', options: opts, value: '0' } },
			onConfirm: function () { const i = Number(this.getFormResult().index) || 0; this.hide(); openModelKeyframeDialog(i) }
		}).show()
		return
	}
	const di = Math.max(0, Math.min(kf.data_points.length - 1, index | 0))
	const dp = kf.data_points[di]
	const cur = ueDpModel(dp) || {}
	const pos = cur.pos || [0, 0, 0], rot = cur.rot || [0, 0, 0]
	new Dialog({
		id: 'universal_emotes_model_kf',
		title: 'Model Event' + (kf.data_points.length > 1 ? ' #' + (di + 1) : ''),
		form: {
			asset_id: { label: 'Model asset', type: 'text', value: cur.asset_id || '' },
			texture: { label: 'Texture (optional)', type: 'text', value: cur.texture || '' },
			attach_mode: { label: 'Attach mode', type: 'select', options: { bone: 'Bone', model_root: 'Model root', world: 'World' }, value: cur.attach_mode || 'bone' },
			bone: { label: 'Bone', type: 'text', value: cur.bone || '' },
			_p: '_',
			px: { label: 'Pos X', type: 'number', value: pos[0], step: 0.1 },
			py: { label: 'Pos Y', type: 'number', value: pos[1], step: 0.1 },
			pz: { label: 'Pos Z', type: 'number', value: pos[2], step: 0.1 },
			_r: '_',
			rx: { label: 'Rot X', type: 'number', value: rot[0], step: 1 },
			ry: { label: 'Rot Y', type: 'number', value: rot[1], step: 1 },
			rz: { label: 'Rot Z', type: 'number', value: rot[2], step: 1 },
			_s: '_',
			scale: { label: 'Scale', type: 'number', value: cur.scale != null ? cur.scale : 1, step: 0.05 },
			end: { label: 'End time (blank = none)', type: 'text', value: cur.end != null ? String(cur.end) : '' }
		},
		onConfirm: function () {
			const r = this.getFormResult()
			try {
				ueEditKeyframes([kf], 'Edit model event', function () { ueWriteDpModel(dp, ueModelFromValues(r, (ueDpModel(dp) || {}).track)) })
			} catch (e) { ueFail('Could not save the model event', e); return }
			this.hide()
			ueRebuildKfFields()
			try { updateParticleMarkers(false) } catch (e) {}
			ueNotify('Model event saved')
		}
	}).show()
}

function currentEffectsAnimator() {
	try {
		const anim = (typeof Animation !== 'undefined') ? Animation.selected : null
		return (anim && anim.animators) ? (anim.animators.effects || null) : null
	} catch (e) { return null }
}
function stopAllUeAudio() {
	try { ue_active_audio.forEach(function (a) { try { a.pause(); a.src = '' } catch (e) {} }) } catch (e) {}
	ue_active_audio = []
}
function playSoundAssetRef(ref, volume, pitch, offset) {
	try {
		const a = ueFindAsset('sound', ref)
		if (!a || !a.b64) return
		const audio = new Audio('data:audio/ogg;base64,' + a.b64)
		audio.volume = Math.max(0, Math.min(1, volume == null ? 1 : volume))
		try { if ('preservesPitch' in audio) audio.preservesPitch = false } catch (e) {}
		if (pitch && isFinite(pitch)) audio.playbackRate = Math.max(0.25, Math.min(4, pitch))
		const seek = (offset && isFinite(offset) && offset > 0) ? offset : 0
		function startAt() { try { if (seek > 0) audio.currentTime = seek } catch (e) {} audio.play().catch(function () {}) }
		if (seek > 0 && audio.readyState < 1) audio.addEventListener('loadedmetadata', startAt, { once: true })
		else startAt()
		ue_active_audio.push(audio)
		audio.addEventListener('ended', function () { const i = ue_active_audio.indexOf(audio); if (i !== -1) ue_active_audio.splice(i, 1) })
	} catch (e) {}
}
function onTimelineFrame() {
	try {
		const playing = ueIsPlaying()
		const t = ueTime()
		try { ueUpdateSkinForTime(t) } catch (e) {}
		if (!playing) {
			if (ue_was_playing) { stopAllUeAudio(); ue_was_playing = false }
			ue_last_play_time = -1; ue_played_marks = {}
			updateParticleMarkers(false)
			return
		}
		const ea = currentEffectsAnimator()
		if (!ue_was_playing) {
			ue_was_playing = true
			stopAllUeAudio()
			ue_played_marks = {}
			ue_last_play_time = t
			if (ea && ea.sound && ueChannelVisible('sound')) {
				let best = null
				for (const kf of ea.sound) { const kt = round(kf.time); if (kt <= t && (!best || kt > round(best.time))) best = kf }
				if (best) {
					const kt = round(best.time)
					ue_played_marks[(best.uuid || 'k') + '_' + kt] = true
					const dp = (best.data_points && best.data_points[0]) || {}
					const vp = readSoundParams(best, dp)
					playSoundAssetRef(dp.effect || dp.sound || '', vp.volume, vp.pitch, t - kt)
				}
			}
			updateParticleMarkers(true)
			return
		}
		if (t < ue_last_play_time) { stopAllUeAudio(); ue_played_marks = {} }
		if (ea && ea.sound && ueChannelVisible('sound')) {
			for (const kf of ea.sound) {
				const kt = round(kf.time)
				if (kt > ue_last_play_time && kt <= t) {
					const key = (kf.uuid || 'k') + '_' + kt
					if (!ue_played_marks[key]) {
						ue_played_marks[key] = true
						const dp = (kf.data_points && kf.data_points[0]) || {}
						const vp = readSoundParams(kf, dp)
						playSoundAssetRef(dp.effect || dp.sound || '', vp.volume, vp.pitch, 0)
					}
				}
			}
		}
		ue_last_play_time = t
		updateParticleMarkers(true)
	} catch (e) { ueWarnOnce('timeline_frame', 'timeline frame update failed:', e) }
}
function installPreviewHooks() {
	if (ue_sound_hook_installed) return
	try {
		if (typeof Blockbench !== 'undefined' && Blockbench.on) {
			Blockbench.on('display_animation_frame', onTimelineFrame)
			Blockbench.on('render_frame', onTimelineFrame)
			ue_sound_hook_installed = true
		}
	} catch (e) {}
}
function uninstallPreviewHooks() {
	try {
		if (typeof Blockbench !== 'undefined' && Blockbench.removeListener) {
			Blockbench.removeListener('display_animation_frame', onTimelineFrame)
			Blockbench.removeListener('render_frame', onTimelineFrame)
		}
	} catch (e) {}
	ue_sound_hook_installed = false
	ue_last_play_time = -1
	ue_played_marks = {}
	try { ueClearModelRenders() } catch (e) {}
	try { ueResetSkin(); ue_skin_current = null } catch (e) {}
}


let ue_loop_prop = null
let ue_loop_orig_timeline_loop = null
let ue_loop_bar_timer = null
let ue_loop_drag = null

function ueRegisterLoopStartProperty() {
	if (ue_loop_prop) return
	try {
		if (typeof Property !== 'undefined' && typeof Animation !== 'undefined')
			ue_loop_prop = new Property(Animation, 'number', 'ue_loop_start', { default: 0 })
	} catch (e) { ueWarnOnce('loop_prop', 'loop start property unavailable:', e) }
}
function ueUnregisterLoopStartProperty() {
	try { if (ue_loop_prop && ue_loop_prop.delete) ue_loop_prop.delete() } catch (e) {}
	ue_loop_prop = null
}
function ueRawLoopStart(anim) { return anim ? Math.max(0, Number(anim.ue_loop_start) || 0) : 0 }
function ueLoopStart(anim) {
	if (!anim || anim.loop !== 'loop') return 0
	const v = ueRawLoopStart(anim), len = Number(anim.length) || 0
	return (v > 0 && v < len - 1e-4) ? v : 0
}
function ueSetLoopStart(anim, value, undoName) {
	if (!anim) return
	const v = Math.max(0, Math.round((Number(value) || 0) * 10000) / 10000)
	try { if (typeof Undo !== 'undefined' && undoName) Undo.initEdit({ animations: [anim] }) } catch (e) {}
	anim.ue_loop_start = v
	try { if (typeof Undo !== 'undefined' && undoName) Undo.finishEdit(undoName) } catch (e) {}
	markProjectDirty()
	ueUpdateLoopBar()
}

function ueInstallLoopPlayback() {
	if (ue_loop_orig_timeline_loop || typeof Timeline === 'undefined' || typeof Timeline.loop !== 'function') return
	ue_loop_orig_timeline_loop = Timeline.loop
	Timeline.loop = function () {
		const anim = (typeof Animation !== 'undefined') ? Animation.selected : null
		const before = Timeline.time
		const result = ue_loop_orig_timeline_loop.apply(this, arguments)
		try {
			const ls = ueLoopStart(anim)
			const ranged = Timeline.custom_range && Timeline.custom_range[1]
			if (ls > 0 && !ranged && Timeline.playing && Timeline.time < before - 1e-6 && Timeline.time < ls) {
				Timeline.setTime(ls)
				Animator.preview(true)
			}
		} catch (e) { ueWarnOnce('loop_playback', 'loop start playback failed:', e) }
		return result
	}
}
function ueUninstallLoopPlayback() {
	try { if (ue_loop_orig_timeline_loop) Timeline.loop = ue_loop_orig_timeline_loop } catch (e) {}
	ue_loop_orig_timeline_loop = null
}

let ue_loop_orig_load = null
function ueBedrockAnimCodec() {
	try { return (typeof AnimationCodec !== 'undefined' && AnimationCodec.codecs) ? AnimationCodec.codecs.bedrock : null } catch (e) { return null }
}
function ueInstallLoopImport() {
	const codec = ueBedrockAnimCodec()
	if (!codec || ue_loop_orig_load || typeof codec.loadFile !== 'function') return
	ue_loop_orig_load = codec.loadFile
	codec.loadFile = function (file, filter) {
		const created = ue_loop_orig_load.apply(this, arguments)
		try {
			const json = file.json || JSON.parse(file.content)
			const list = Array.isArray(created) ? created : []
			for (const key in (json && json.animations) || {}) {
				const ls = Number(json.animations[key] && json.animations[key].loop_start)
				if (!(ls > 0)) continue
				const anim = list.find(function (a) { return a.name === key }) ||
					Animation.all.find(function (a) { return a.name === key })
				if (anim) anim.ue_loop_start = ls
			}
		} catch (e) { ueWarnOnce('loop_import', 'loop_start import failed:', e) }
		return created
	}
}
function ueUninstallLoopImport() {
	const codec = ueBedrockAnimCodec()
	try { if (codec && ue_loop_orig_load) codec.loadFile = ue_loop_orig_load } catch (e) {}
	ue_loop_orig_load = null
}

const UE_LOOP_BAR_CSS = `
#ue_loop_bar { position: absolute; left: 0; top: 0; height: 6px; pointer-events: none; z-index: 3; }
#ue_loop_bar .ue_intro { position: absolute; top: 0; height: 6px; opacity: .55;
	background: repeating-linear-gradient(135deg, var(--color-subtle_text) 0 3px, transparent 3px 6px); }
#ue_loop_bar .ue_loop { position: absolute; top: 0; height: 6px; background: var(--color-accent); opacity: .75; border-radius: 0 3px 3px 0; }
#ue_loop_bar.ue_full .ue_loop { opacity: .35; }
#ue_loop_bar .ue_handle { position: absolute; top: -1px; width: 9px; height: 14px; margin-left: -4px; pointer-events: auto;
	cursor: ew-resize; background: var(--color-accent); border: 1px solid var(--color-dark); border-radius: 2px; }
#ue_loop_bar .ue_handle:hover, #ue_loop_bar .ue_handle.ue_dragging { filter: brightness(1.25); }
#ue_loop_bar.ue_invalid .ue_handle { background: var(--color-close); }
#ue_loop_bar .ue_handle::after { content: '\\21BA'; position: absolute; left: 11px; top: -3px; font-size: 11px;
	color: var(--color-accent); pointer-events: none; }
`
let ue_loop_css_el = null
function ueLoopBarEl() {
	const host = document.getElementById('timeline_time')
	if (!host) return null
	let bar = document.getElementById('ue_loop_bar')
	if (bar && bar.parentNode === host) return bar
	if (bar) bar.remove()
	if (!ue_loop_css_el) {
		ue_loop_css_el = document.createElement('style')
		ue_loop_css_el.textContent = UE_LOOP_BAR_CSS
		document.head.appendChild(ue_loop_css_el)
	}
	bar = document.createElement('div')
	bar.id = 'ue_loop_bar'
	bar.innerHTML = '<div class="ue_intro"></div><div class="ue_loop"></div><div class="ue_handle"></div>'
	const handle = bar.querySelector('.ue_handle')
	handle.addEventListener('mousedown', ueLoopDragStart)
	handle.addEventListener('dblclick', function (e) {
		e.preventDefault(); e.stopPropagation()
		const anim = Animation.selected
		if (anim) { ueSetLoopStart(anim, 0, 'Reset loop start'); ueNotify('Loop start reset: the whole animation loops') }
	})
	handle.addEventListener('touchstart', function (e) { e.stopPropagation() })
	host.appendChild(bar)
	return bar
}
function ueUpdateLoopBar() {
	try {
		const anim = (typeof Animation !== 'undefined') ? Animation.selected : null
		const bar = ueLoopBarEl()
		if (!bar) return
		const show = !!(anim && anim.loop === 'loop' && typeof Timeline !== 'undefined' && Timeline.vue)
		bar.style.display = show ? '' : 'none'
		if (!show) return
		const size = Timeline.vue.size || Timeline.vue._data.size || 1
		const len = Number(anim.length) || 0
		const raw = ue_loop_drag ? ue_loop_drag.value : ueRawLoopStart(anim)
		const invalid = raw > 0 && raw >= len - 1e-4
		const ls = invalid ? len : raw
		bar.classList.toggle('ue_full', ls <= 0)
		bar.classList.toggle('ue_invalid', invalid)
		bar.style.width = (len * size) + 'px'
		const intro = bar.querySelector('.ue_intro'), loop = bar.querySelector('.ue_loop'), handle = bar.querySelector('.ue_handle')
		intro.style.left = '0px'; intro.style.width = (ls * size) + 'px'
		loop.style.left = (ls * size) + 'px'; loop.style.width = Math.max(0, (len - ls) * size) + 'px'
		handle.style.left = (ls * size) + 'px'
		handle.title = invalid
			? 'Loop start (' + round(raw) + 's) is at/after the end: ignored, the whole animation loops. Drag it back or double-click to reset.'
			: (ls > 0
				? 'Loop start ' + round(ls) + 's: 0-' + round(ls) + 's plays once (intro), then ' + round(ls) + '-' + round(len) + 's repeats.\nDrag to move (Ctrl: no snapping), double-click to reset.'
				: 'Loop start: drag right to add an intro that plays once before the loop.\nThe loop always ends at the animation length.')
	} catch (e) { ueWarnOnce('loop_bar', 'loop bar update failed:', e) }
}
function ueLoopDragStart(e) {
	if (e.button !== 0) return
	const anim = (typeof Animation !== 'undefined') ? Animation.selected : null
	if (!anim) return
	e.preventDefault(); e.stopPropagation()
	const host = document.getElementById('timeline_time')
	const handle = e.currentTarget
	handle.classList.add('ue_dragging')
	try { Undo.initEdit({ animations: [anim] }) } catch (err) {}
	ue_loop_drag = { anim: anim, value: ueRawLoopStart(anim) }
	function move(ev) {
		const size = Timeline.vue.size || Timeline.vue._data.size || 1
		let t = (ev.clientX - host.getBoundingClientRect().left) / size
		if (!(ev.ctrlKey || ev.metaKey)) t = Timeline.snapTime(t)
		const step = (Timeline.getStep && Timeline.getStep()) || 0.05
		t = Math.max(0, Math.min(t, (Number(anim.length) || 0) - step))
		ue_loop_drag.value = t
		ueUpdateLoopBar()
		try { Blockbench.setCursorTooltip(t > 0 ? ('loop from ' + round(t) + 's') : 'no intro') } catch (err) {}
	}
	function up() {
		document.removeEventListener('mousemove', move)
		document.removeEventListener('mouseup', up)
		handle.classList.remove('ue_dragging')
		anim.ue_loop_start = Math.round(ue_loop_drag.value * 10000) / 10000
		ue_loop_drag = null
		try { Undo.finishEdit('Change loop start') } catch (err) {}
		try { Blockbench.setCursorTooltip() } catch (err) {}
		markProjectDirty()
		ueUpdateLoopBar()
	}
	document.addEventListener('mousemove', move)
	document.addEventListener('mouseup', up)
}
function ueInstallLoopBar() {
	if (ue_loop_bar_timer) return
	ue_loop_bar_timer = setInterval(ueUpdateLoopBar, 150)
	ueUpdateLoopBar()
}
function ueUninstallLoopBar() {
	if (ue_loop_bar_timer) clearInterval(ue_loop_bar_timer)
	ue_loop_bar_timer = null
	const bar = document.getElementById('ue_loop_bar')
	if (bar) bar.remove()
	if (ue_loop_css_el) { ue_loop_css_el.remove(); ue_loop_css_el = null }
}

function ueScene() { try { return (typeof Canvas !== 'undefined' && Canvas.scene) ? Canvas.scene : null } catch (e) { return null } }
function ueTHREE() { try { return (typeof THREE !== 'undefined') ? THREE : null } catch (e) { return null } }
function ueIsKeyframeSelected(kf) { return ueSelectedKeyframes().indexOf(kf) !== -1 }
function makeMarker(c1, c2, fallback) {
	const T = ueTHREE(), scene = ueScene(); if (!T || !scene) return null
	let mat
	try {
		const cvs = document.createElement('canvas'); cvs.width = cvs.height = 32
		const ctx = cvs.getContext('2d')
		const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16)
		g.addColorStop(0, c1 || 'rgba(130,205,255,0.95)'); g.addColorStop(1, c2 || 'rgba(80,140,255,0)')
		ctx.fillStyle = g; ctx.beginPath(); ctx.arc(16, 16, 16, 0, Math.PI * 2); ctx.fill()
		const tex = new T.Texture(cvs); tex.needsUpdate = true
		mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
	} catch (e) { mat = new T.SpriteMaterial({ color: fallback || 0x77ccff, transparent: true, depthTest: false }) }
	const sp = new T.Sprite(mat)
	sp.scale.set(4, 4, 4); sp.renderOrder = 990; sp.name = 'ue_preview_marker'
	try { scene.add(sp) } catch (e) { return null }
	return sp
}
function ueMakeImageSprite(dataUrl) {
	const T = ueTHREE(), scene = ueScene(); if (!T || !scene) return null
	let mat
	try {
		const img = new Image()
		const tex = new T.Texture(img)
		try { tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestFilter } catch (e) {}
		img.onload = function () { try { tex.needsUpdate = true } catch (e) {} }
		img.src = dataUrl
		mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
	} catch (e) { return null }
	const sp = new T.Sprite(mat)
	sp.scale.set(4, 4, 4); sp.renderOrder = 990; sp.name = 'ue_preview_marker'
	try { scene.add(sp) } catch (e) { return null }
	return sp
}
function clearParticleMarkers() {
	try { const scene = ueScene(); for (const k in ue_particle_markers) { const m = ue_particle_markers[k]; if (m && m.parent) m.parent.remove(m); else if (m && scene) scene.remove(m) } } catch (e) {}
	ue_particle_markers = {}
}
const UE_PARTICLE_LIFE = 0.5
function ueChannelDisplayNames(channelId) {
	if (channelId === 'particle') return ['Particle']
	if (channelId === 'sound') return ['Sound']
	if (channelId === 'timeline') return ['Instruction', 'Timeline']
	if (channelId === 'models') return ['Models']
	return []
}
function ueChannelMutedDom(names) {
	try {
		const bars = document.querySelectorAll('.animator_channel_bar')
		for (let i = 0; i < bars.length; i++) {
			const span = bars[i].querySelector('.channel_head > span')
			const nm = span ? (span.textContent || '').trim() : ''
			if (names.indexOf(nm) !== -1) {
				const icon = bars[i].querySelector('.channel_mute')
				const txt = icon ? (icon.textContent || '').trim().toLowerCase() : ''
				if (!txt) return null
				return txt.indexOf('off') !== -1
			}
		}
	} catch (e) {}
	return null
}
function ueChannelVisible(channelId) {
	try {
		const ea = currentEffectsAnimator()
		if (ea && ea.muted && typeof ea.muted === 'object' && Object.prototype.hasOwnProperty.call(ea.muted, channelId)) return !ea.muted[channelId]
	} catch (e) {}
	const muted = ueChannelMutedDom(ueChannelDisplayNames(channelId))
	if (muted === null) return true
	return !muted
}
function updateParticleMarkers(playing) {
	try {
		const scene = ueScene(); if (!scene) return
		if (!ueInAnimateMode()) { clearParticleMarkers(); try { ueClearModelRenders() } catch (e) {} return }
		const ea = currentEffectsAnimator()
		const t = ueTime()
		const wanted = {}
		if (ea && ea.particle && ueChannelVisible('particle')) {
			for (const kf of ea.particle) {
				const kt = round(kf.time)
				const active = (t >= kt - 0.001 && t <= kt + UE_PARTICLE_LIFE)
				const dps = (kf.data_points && kf.data_points.length) ? kf.data_points : [{}]
				dps.forEach(function (dp, di) {
					const k = (kf.uuid || ('p' + kt)) + ':' + di
					if (!active && !ueIsGizmoKey('particle', k)) return
					const tr = readEffectTransform(kf, dp)
					const bone = (dp.locator && ueBoneMesh(dp.locator)) ? dp.locator : ''
					wanted[k] = { pos: tr.pos || (bone ? [0, 0, 0] : [0, 12, 0]), bone: bone, kind: 'particle', ref: (dp.effect || dp.particle || ''), kf: kf, di: di }
				})
			}
		}
		for (const k in ue_particle_markers) { if (!wanted[k]) { try { const om = ue_particle_markers[k]; (om.parent || scene).remove(om) } catch (e) {} delete ue_particle_markers[k] } }
		for (const k in wanted) {
			const w = wanted[k]
			const url = w.ref ? ueTextureAssetDataUrl(w.ref) : null
			let m = ue_particle_markers[k]
			if (m && m.userData && m.userData.ueRef !== (w.ref || '')) { try { (m.parent || scene).remove(m) } catch (e) {} delete ue_particle_markers[k]; m = null }
			if (!m) {
				m = url ? ueMakeImageSprite(url) : makeMarker()
				if (!m) continue
				m.userData = m.userData || {}; m.userData.ueRef = (w.ref || '')
				ue_particle_markers[k] = m
			}
			const pkey = w.bone ? ('bone:' + w.bone) : 'world'
			if (m.userData.ueParentKey !== pkey) {
				const parentObj = w.bone ? (ueBoneMesh(w.bone) || scene) : scene
				try { if (m.parent) m.parent.remove(m); parentObj.add(m) } catch (e) { try { scene.add(m) } catch (e2) {} }
				m.userData.ueParentKey = pkey
			}
			const p = w.pos; m.position.set(p[0] || 0, p[1] || 0, p[2] || 0); m.visible = true
			m.userData.ueTarget = { kind: 'particle', key: k }
			m.userData.ueSrc = { kf: w.kf, di: w.di }
		}
		try { ueUpdateModelRenders(playing) } catch (e) {}
		try { ueGizmoFollow() } catch (e) {}
	} catch (e) { ueWarnOnce('particle_markers', 'particle markers update failed:', e) }
}

function ueInAnimateMode() {
	try {
		if (typeof Modes !== 'undefined' && Modes.animate === true) return true
		if (typeof Mode !== 'undefined' && Mode.selected && Mode.selected.id === 'animate') return true
		if (typeof Modes !== 'undefined' && Modes.selected && Modes.selected.id === 'animate') return true
		if (typeof Animator !== 'undefined' && Animator.open) return true
	} catch (e) {}
	return false
}
function ueFindAsset(type, ref) {
	try {
		const store = getStore(); if (!store) return null
		const name = String(ref || '').split(':').pop().split('/').pop()
		if (!name) return null
		const list = store.assets || []
		let a = list.find(function (x) { return x.type === type && x.name === name })
		if (!a) { const slug = slugifyBase(name.replace(/\.(png|ogg|json)$/i, '')); a = list.find(function (x) { return x.type === type && x.name === slug }) }
		return a || null
	} catch (e) { return null }
}
function ueModelAssetText(assetId) {
	const a = ueFindAsset('model', assetId)
	return (a && a.text) ? a.text : null
}
function ueParseGeometry(jsonText) {
	let data
	try { data = JSON.parse(jsonText) } catch (e) { return null }
	if (!data || typeof data !== 'object') return null
	try {
		if (Array.isArray(data['minecraft:geometry']) && data['minecraft:geometry'].length) {
			const g = data['minecraft:geometry'][0]
			const d = (g && g.description) || {}
			return { type: 'bedrock', bones: (g && g.bones) ? g.bones : [], texW: Number(d.texture_width) || 16, texH: Number(d.texture_height) || 16 }
		}
		for (const k in data) {
			if (k.indexOf('geometry.') === 0 && data[k] && data[k].bones) return { type: 'bedrock', bones: data[k].bones, texW: Number(data[k].texturewidth) || 16, texH: Number(data[k].textureheight) || 16 }
		}
		if (Array.isArray(data.elements)) return { type: 'java', elements: data.elements, texW: 16, texH: 16, textures: (data.textures && typeof data.textures === 'object') ? data.textures : {} }
	} catch (e) {}
	return null
}
function ueResolveModelTextureUrl(m) {
	if (!m) return null
	try { if (m.texture) { const u = ueTextureAssetDataUrl(m.texture); if (u) return u } } catch (e) {}
	try { return ueTextureAssetDataUrl(m.asset_id) } catch (e) {}
	return null
}
function ueJavaSlotTextureUrl(faceRef, texturesMap, fallbackUrl) {
	try {
		let key = String(faceRef || '').replace(/^#/, '')
		let val = (texturesMap && key) ? texturesMap[key] : null
		let guard = 0
		while (val && typeof val === 'string' && val.charAt(0) === '#' && guard < 6) { val = texturesMap[val.slice(1)]; guard++ }
		if (val && typeof val === 'string') {
			const u = ueTextureAssetDataUrl(val)
			if (u) return u
		}
	} catch (e) {}
	return fallbackUrl || null
}
function ueMakeModelTexture(dataUrl) {
	const T = ueTHREE(); if (!T || !dataUrl) return null
	try {
		const img = new Image()
		const tex = new T.Texture(img)
		try { tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestFilter } catch (e) {}
		try { tex.generateMipmaps = false } catch (e) {}
		img.onload = function () { try { tex.needsUpdate = true } catch (e) {} }
		img.src = dataUrl
		return tex
	} catch (e) { return null }
}
const UE_FACE_INDEX = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 }
function ueSetFaceUV(geo, fi, x1, y1, x2, y2, texW, texH) {
	try {
		if (fi == null || !geo || !geo.attributes || !geo.attributes.uv) return
		const uv = geo.attributes.uv
		const u1 = x1 / texW, u2 = x2 / texW
		const a1 = 1 - (y1 / texH), a2 = 1 - (y2 / texH)
		const o = fi * 4
		uv.setXY(o + 0, u1, a1)
		uv.setXY(o + 1, u2, a1)
		uv.setXY(o + 2, u1, a2)
		uv.setXY(o + 3, u2, a2)
		uv.needsUpdate = true
	} catch (e) {}
}
function ueApplyCubeUV(geo, c, parsed) {
	try {
		const texW = parsed.texW || 16, texH = parsed.texH || 16
		if (parsed.type === 'java') {
			const faces = (c && c.faces) || {}
			for (const name in faces) {
				const f = faces[name]; if (!f || !f.uv) continue
				ueSetFaceUV(geo, UE_FACE_INDEX[name], f.uv[0], f.uv[1], f.uv[2], f.uv[3], texW, texH)
			}
			return
		}
		const uv = c && c.uv
		if (uv && !Array.isArray(uv) && typeof uv === 'object') {
			for (const name in uv) {
				const f = uv[name]; if (!f || !f.uv) continue
				const su = f.uv_size || [0, 0]
				ueSetFaceUV(geo, UE_FACE_INDEX[name], f.uv[0], f.uv[1], f.uv[0] + su[0], f.uv[1] + su[1], texW, texH)
			}
			return
		}
		if (Array.isArray(uv)) {
			const s = c.size || [0, 0, 0]
			const W = Math.abs(s[0] || 0), H = Math.abs(s[1] || 0), D = Math.abs(s[2] || 0)
			const U = uv[0] || 0, V = uv[1] || 0
			const mir = !!c.mirror
			function set(fi, x1, y1, x2, y2) { if (mir) { const t = x1; x1 = x2; x2 = t } ueSetFaceUV(geo, fi, x1, y1, x2, y2, texW, texH) }
			set(UE_FACE_INDEX.up,    U + D,             V,     U + D + W,         V + D)
			set(UE_FACE_INDEX.down,  U + D + W,         V + D, U + D + 2 * W,     V)
			set(UE_FACE_INDEX.east,  U,                 V + D, U + D,             V + D + H)
			set(UE_FACE_INDEX.north, U + D,             V + D, U + D + W,         V + D + H)
			set(UE_FACE_INDEX.west,  U + D + W,         V + D, U + 2 * D + W,     V + D + H)
			set(UE_FACE_INDEX.south, U + 2 * D + W,     V + D, U + 2 * D + 2 * W, V + D + H)
		}
	} catch (e) {}
}
function ueBuildModelMesh(jsonText, textureUrl) {
	const T = ueTHREE(); if (!T) return null
	const parsed = ueParseGeometry(jsonText); if (!parsed) return null
	const root = new T.Group(); root.name = 'ue_model_render'
	const tex = textureUrl ? ueMakeModelTexture(textureUrl) : null
	const texByUrl = {}, matByUrl = {}
	const invisMat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
	function texFor(url) {
		if (!url) return null
		if (url === textureUrl && tex) return tex
		if (texByUrl[url]) return texByUrl[url]
		const t = ueMakeModelTexture(url); texByUrl[url] = t; return t
	}
	function matFor(url) {
		const key = url || ''
		if (matByUrl[key]) return matByUrl[key]
		const tt = texFor(url)
		const mm = tt
			? new T.MeshLambertMaterial({ map: tt, emissive: 0xffffff, emissiveMap: tt, emissiveIntensity: 0.25, transparent: true, alphaTest: 0.02, side: T.DoubleSide })
			: new T.MeshLambertMaterial({ color: 0xc2c9d4, emissive: 0x555b63, side: T.DoubleSide })
		matByUrl[key] = mm; return mm
	}
	function mat() { return matFor(textureUrl || '') }
	const UE_FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north']
	function javaFaceMats(el) {
		return UE_FACE_ORDER.map(function (fn) {
			const f = el && el.faces && el.faces[fn]
			if (!f) return invisMat
			return matFor(ueJavaSlotTextureUrl(f.texture, parsed.textures, textureUrl))
		})
	}
	function box(size, inflate) {
		const sx = Math.abs(size[0] || 0) + 2 * (inflate || 0)
		const sy = Math.abs(size[1] || 0) + 2 * (inflate || 0)
		const sz = Math.abs(size[2] || 0) + 2 * (inflate || 0)
		return new T.BoxGeometry(sx || 0.001, sy || 0.001, sz || 0.001)
	}
	try {
		if (parsed.type === 'java') {
			parsed.elements.forEach(function (el) {
				if (!el || !el.from || !el.to) return
				const size = [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]]
				const geo = box(size, 0)
				ueApplyCubeUV(geo, { faces: el.faces, size: size }, parsed)
				const mesh = new T.Mesh(geo, javaFaceMats(el))
				mesh.position.set(el.from[0] + size[0] / 2, el.from[1] + size[1] / 2, el.from[2] + size[2] / 2)
				root.add(mesh)
			})
			return root
		}
		const bones = parsed.bones || []
		const groups = {}
		bones.forEach(function (b) { if (b && b.name) groups[b.name] = new T.Group() })
		bones.forEach(function (b) {
			if (!b || !b.name) return
			const g = groups[b.name]
			const pivot = b.pivot || [0, 0, 0]
			g.position.set(pivot[0] || 0, pivot[1] || 0, pivot[2] || 0)
			if (b.rotation) {
				g.rotation.order = 'ZYX'
				g.rotation.set((-(b.rotation[0] || 0)) * Math.PI / 180, (-(b.rotation[1] || 0)) * Math.PI / 180, (b.rotation[2] || 0) * Math.PI / 180)
			}
			if (b.parent && groups[b.parent]) groups[b.parent].add(g); else root.add(g)
		})
		bones.forEach(function (b) {
			if (!b || !b.name) return
			const g = groups[b.name]
			const pivot = b.pivot || [0, 0, 0]
			if (b.poly_mesh) {
				const boneUrl = b.texture ? (ueTextureAssetDataUrl(b.texture) || textureUrl) : textureUrl
				const pm = ueBuildPolyMesh(T, b.poly_mesh, pivot, parsed)
				if (pm) g.add(new T.Mesh(pm, matFor(boneUrl || '')))
			}
			;(b.cubes || []).forEach(function (c) {
				if (!c) return
				const origin = c.origin || [0, 0, 0]
				const size = c.size || [0, 0, 0]
				const geo = box(size, c.inflate || 0)
				if (tex) ueApplyCubeUV(geo, c, parsed)
				const mesh = new T.Mesh(geo, mat())
				mesh.position.set(
					(origin[0] + (size[0] || 0) / 2) - (pivot[0] || 0),
					(origin[1] + (size[1] || 0) / 2) - (pivot[1] || 0),
					(origin[2] + (size[2] || 0) / 2) - (pivot[2] || 0)
				)
				g.add(mesh)
			})
		})
	} catch (e) { return root }
	return root
}
function ueBuildPolyMesh(T, pm, pivot, parsed) {
	try {
		const P = pm.positions || [], UV = pm.uvs || [], polys = pm.polys
		if (!Array.isArray(polys) || !P.length) return null
		const norm = pm.normalized_uvs !== false
		const tw = parsed.texW || 16, th = parsed.texH || 16
		const pos = [], uv = []
		function corner(c) {
			const p = P[c[0]] || [0, 0, 0]
			pos.push((p[0] || 0) - (pivot[0] || 0), (p[1] || 0) - (pivot[1] || 0), (p[2] || 0) - (pivot[2] || 0))
			const t = (c.length > 2 && UV[c[2]]) ? UV[c[2]] : [0, 0]
			uv.push(norm ? t[0] : t[0] / tw, norm ? t[1] : 1 - t[1] / th)
		}
		polys.forEach(function (poly) {
			if (!Array.isArray(poly) || poly.length < 3) return
			corner(poly[0]); corner(poly[1]); corner(poly[2])
			if (poly.length > 3) { corner(poly[0]); corner(poly[2]); corner(poly[3]) }
		})
		const geo = new T.BufferGeometry()
		geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
		geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
		geo.computeVertexNormals()
		return geo
	} catch (e) { return null }
}
let ue_model_renders = {}
function ueBoneMesh(name) {
	try {
		if (!name || typeof Group === 'undefined' || !Group.all) return null
		const g = Group.all.find(function (x) { return x.name === name })
		return (g && g.mesh) ? g.mesh : null
	} catch (e) { return null }
}
function ueModelRootMesh() {
	try {
		if (typeof Group === 'undefined' || !Group.all) return null
		const root = Group.all.find(function (x) { return x.parent === 'root' || !x.parent })
		return (root && root.mesh) ? root.mesh : null
	} catch (e) { return null }
}
function ueBoneOptions(current) {
	const opts = [['', '\u2014 Select bone \u2014']]
	try { if (typeof Group !== 'undefined' && Group.all) Group.all.forEach(function (g) { if (g && g.name) opts.push([g.name, g.name]) }) } catch (e) {}
	if (current && !opts.some(function (o) { return o[0] === current })) opts.push([current, current])
	return opts
}
function ueClearModelRenders() {
	try { for (const k in ue_model_renders) { const o = ue_model_renders[k]; if (o && o.obj && o.obj.parent) o.obj.parent.remove(o.obj) } } catch (e) {}
	ue_model_renders = {}
}
function ueUpdateModelRenders(playing) {
	try {
		const scene = ueScene(), T = ueTHREE(); if (!scene || !T) return
		if (!ueInAnimateMode()) { ueClearModelRenders(); return }
		if (!ueChannelVisible('models')) { ueClearModelRenders(); return }
		const ea = currentEffectsAnimator()
		const t = ueTime()
		const wanted = {}
		if (ea && ea.models) {
			const coll = ueCollectModelEntries(ea)
			coll.singles.forEach(function (s) {
				const m = s.m, kt = s.time
				const endT = (m.end != null && isFinite(m.end)) ? m.end : Infinity
				const active = (t >= kt - 0.001 && t <= endT + 0.001)
				const k = (s.kf.uuid || ('m' + kt)) + ':' + s.di
				if (active || ueIsKeyframeSelected(s.kf) || ueIsGizmoKey('model', k)) {
					wanted[k] = Object.assign({}, m, { __src: { kind: 'model', key: k, kf: s.kf, di: s.di } })
				}
			})
			for (const id in coll.tracks) {
				const wps = coll.tracks[id]
				if (!wps.length) continue
				const endT = ueTrackEnd(wps)
				const active = (t >= wps[0].time - 0.001 && t <= endT + 0.001)
				const k = 'trk:' + id
				const sel = wps.some(function (w) { return ueIsKeyframeSelected(w.kf) })
				if (!active && !sel && !ueIsGizmoKey('model', k)) continue
				const s = ueEvalTrack(wps, Math.min(Math.max(t, wps[0].time), isFinite(endT) ? endT : t))
				if (!s) continue
				wanted[k] = Object.assign({}, s.base, { pos: s.pos, rot: s.rot, scale: s.scale, __src: { kind: 'model', key: k, track: id } })
			}
		}
		for (const k in ue_model_renders) { if (!wanted[k]) { try { const o = ue_model_renders[k]; if (o.obj && o.obj.parent) o.obj.parent.remove(o.obj) } catch (e) {} delete ue_model_renders[k] } }
		for (const k in wanted) {
			const m = wanted[k]
			let entry = ue_model_renders[k]
			if (!entry || entry.assetId !== m.asset_id || entry.texKey !== ((m.texture || '') + '|' + (m.asset_id || ''))) {
				if (entry && entry.obj && entry.obj.parent) { try { entry.obj.parent.remove(entry.obj) } catch (e) {} }
				const txt = ueModelAssetText(m.asset_id)
				const texUrl = ueResolveModelTextureUrl(m)
				const obj = txt ? ueBuildModelMesh(txt, texUrl) : null
				if (!obj) { delete ue_model_renders[k]; continue }
				entry = ue_model_renders[k] = { obj: obj, assetId: m.asset_id, texKey: (m.texture || '') + '|' + (m.asset_id || ''), parentKey: null }
			}
			const obj = entry.obj
			entry.src = m.__src
			obj.userData = obj.userData || {}
			obj.userData.ueTarget = { kind: 'model', key: k }
			let parentObj = scene, pkey = 'world'
			if (m.attach_mode === 'bone' && m.bone) { const bm = ueBoneMesh(m.bone); if (bm) { parentObj = bm; pkey = 'bone:' + m.bone } }
			else if (m.attach_mode === 'model_root') { const rm = ueModelRootMesh(); if (rm) { parentObj = rm.parent || rm; pkey = 'model_root' } }
			if (entry.parentKey !== pkey) {
				if (obj.parent) { try { obj.parent.remove(obj) } catch (e) {} }
				try { parentObj.add(obj) } catch (e) { try { scene.add(obj); pkey = 'world' } catch (e2) { continue } }
				entry.parentKey = pkey
			}
			const p = m.pos || [0, 0, 0]
			obj.position.set(p[0] || 0, p[1] || 0, p[2] || 0)
			const r = m.rot || [0, 0, 0]
			obj.rotation.order = 'ZYX'
			obj.rotation.set((r[0] || 0) * Math.PI / 180, (r[1] || 0) * Math.PI / 180, (r[2] || 0) * Math.PI / 180)
			const sc = (m.scale != null && isFinite(m.scale) && m.scale > 0) ? m.scale : 1
			obj.scale.set(sc, sc, sc)
			obj.visible = true
		}
	} catch (e) { ueWarnOnce('model_renders', 'model renders update failed:', e) }
}

let ue_gizmo_target = null
let ue_drag = null
let ue_transform_module = null
let ue_gizmo_warned = false

function ueIsGizmoKey(kind, key) { return !!(ue_gizmo_target && ue_gizmo_target.kind === kind && ue_gizmo_target.key === key) }
function ueGizmoObject() {
	const g = ue_gizmo_target; if (!g) return null
	try {
		if (g.kind === 'model') { const e = ue_model_renders[g.key]; return (e && e.obj && e.obj.parent) ? e.obj : null }
		if (g.kind === 'particle') { const m = ue_particle_markers[g.key]; return (m && m.parent) ? m : null }
	} catch (e) {}
	return null
}
function ueTransformerUpdate() {
	try { if (typeof Transformer !== 'undefined' && Transformer && Transformer.updateSelection) Transformer.updateSelection() } catch (e) {}
}
function ueSetGizmoTarget(t) {
	if (t) { try { if (typeof unselectAllElements === 'function') unselectAllElements() } catch (e) {} }
	ue_gizmo_target = t ? { kind: t.kind, key: t.key } : null
	try { updateParticleMarkers(false) } catch (e) {}
	ueTransformerUpdate()
}
function ueClearGizmoTarget() {
	if (!ue_gizmo_target) return
	if (ue_drag) return
	ue_gizmo_target = null
	ueTransformerUpdate()
}
function ueGizmoFollow() {
	if (!ue_gizmo_target) return
	if (!ueInAnimateMode()) { ueClearGizmoTarget(); return }
	try {
		if (typeof Transformer !== 'undefined' && Transformer && !Transformer.dragging && Transformer.center) Transformer.center()
	} catch (e) {}
}
function ueToolChannel() {
	try {
		const tl = (typeof Toolbox !== 'undefined') ? Toolbox.selected : null
		if (tl && tl.animation_channel) return tl.animation_channel
		if (tl && tl.id === 'rotate_tool') return 'rotation'
		if (tl && tl.id === 'resize_tool') return 'scale'
	} catch (e) {}
	return 'position'
}
function ueKfEps() { let s = 0; try { s = Timeline.getStep() / 2 } catch (e) {} return (s && isFinite(s)) ? s : 0.01 }
function ueFindKfAt(list, t) { const eps = ueKfEps(); return (list || []).find(function (k) { return Math.abs(k.time - t) <= eps }) || null }
function ueCreateEffectKf(ea, channel, t) {
	try {
		if (!ea[channel]) ea[channel] = []
		const kf = ea.createKeyframe({}, t, channel, false, false)
		if (kf && (!kf.data_points || !kf.data_points.length)) kf.data_points = [ueNewDataPoint(kf)]
		return kf || null
	} catch (e) { ueLog.error('create keyframe failed:', e); return null }
}
function ueUniq(arr) { const o = []; arr.forEach(function (x) { if (x && o.indexOf(x) === -1) o.push(x) }); return o }

function ueBeginGizmoEdit() {
	const tgt = ue_gizmo_target
	const ea = currentEffectsAnimator()
	if (!tgt || !ea || typeof Undo === 'undefined') return null
	const t = ueTime()
	const eps = ueKfEps()
	const Z = [0, 0, 0]
	if (tgt.kind === 'model') {
		const entry = ue_model_renders[tgt.key]
		const src = entry && entry.src
		if (!src) return null
		let kf = null, di = 0, baseM = null, needNew = false, linkDp = null, linkM = null
		const initKfs = []
		if (src.track) {
			const wps = ueCollectModelEntries(ea).tracks[src.track] || []
			if (!wps.length) return null
			const on = wps.find(function (w) { return Math.abs(w.kf.time - t) <= eps })
			if (on) { kf = on.kf; di = on.di; baseM = on.m; initKfs.push(kf) }
			else {
				const s = ueEvalTrack(wps, t)
				baseM = Object.assign({}, s.base, { pos: r4v(s.pos), rot: r4v(s.rot), scale: r4(s.scale), track: src.track })
				needNew = true
			}
		} else {
			const skf = src.kf, sdp = skf && skf.data_points && skf.data_points[src.di]
			const m = ueDpModel(sdp)
			if (!m || !m.asset_id) return null
			if (Math.abs(skf.time - t) <= eps) { kf = skf; di = src.di; baseM = m; initKfs.push(kf) }
			else {
				if (!m.track) { m.track = ueNewTrackId(); linkDp = sdp; linkM = m; initKfs.push(skf) }
				baseM = Object.assign({}, m)
				needNew = true
			}
		}
		const newKfs = []
		if (needNew) {
			if (baseM.end != null && isFinite(baseM.end) && baseM.end <= t + 1e-6) baseM.end = undefined
			const at = ueFindKfAt(ea.models, t)
			if (at) initKfs.push(at)
			Undo.initEdit({ keyframes: ueUniq(initKfs) })
			if (linkDp) ueWriteDpModel(linkDp, linkM)
			if (at) { kf = at; kf.data_points.push(ueNewDataPoint(kf)); di = kf.data_points.length - 1 }
			else {
				kf = ueCreateEffectKf(ea, 'models', t)
				if (!kf) { try { Undo.cancelEdit(true) } catch (e) {} return null }
				di = 0; newKfs.push(kf)
			}
			ueWriteDpModel(kf.data_points[di], baseM)
			tgt.key = baseM.track ? ('trk:' + baseM.track) : ((kf.uuid || '') + ':' + di)
		} else {
			Undo.initEdit({ keyframes: ueUniq(initKfs) })
		}
		return {
			kind: 'model', kf: kf, di: di, m: Object.assign({}, baseM),
			state: { pos: ueVec(baseM.pos, Z), rot: ueVec(baseM.rot, Z), scale: (baseM.scale != null && isFinite(baseM.scale)) ? baseM.scale : 1 },
			kfs: ueUniq(initKfs.concat(newKfs))
		}
	}
	if (tgt.kind === 'particle') {
		const mk = ue_particle_markers[tgt.key]
		const src = mk && mk.userData && mk.userData.ueSrc
		if (!src || !src.kf) return null
		const skf = src.kf, sdp = (skf.data_points && skf.data_points[src.di]) || {}
		const tr = readEffectTransform(skf, sdp)
		const state = { pos: ueVec(tr.pos, [0, 12, 0]), rot: ueVec(tr.rot, Z), scale: 1 }
		if (Math.abs(skf.time - t) <= eps) {
			Undo.initEdit({ keyframes: [skf] })
			return { kind: 'particle', kf: skf, di: src.di, state: state, kfs: [skf] }
		}
		const at = ueFindKfAt(ea.particle, t)
		Undo.initEdit({ keyframes: at ? [at] : [] })
		let kf, di = 0
		const newKfs = []
		if (at) { kf = at; kf.data_points.push(ueNewDataPoint(kf)); di = kf.data_points.length - 1 }
		else {
			kf = ueCreateEffectKf(ea, 'particle', t)
			if (!kf) { try { Undo.cancelEdit(true) } catch (e) {} return null }
			newKfs.push(kf)
		}
		const nd = kf.data_points[di]
		;['effect', 'locator', 'script', 'file', 'bind_to_actor'].forEach(function (p) { if (sdp[p] !== undefined) nd[p] = sdp[p] })
		nd.ue_pos = r4v(state.pos).join(','); nd.ue_rot = r4v(state.rot).join(',')
		tgt.key = (kf.uuid || '') + ':' + di
		return { kind: 'particle', kf: kf, di: di, state: state, kfs: ueUniq((at ? [at] : []).concat(newKfs)) }
	}
	return null
}
function ueWriteDragState(d) {
	const dp = d.kf && d.kf.data_points && d.kf.data_points[d.di]
	if (!dp) return
	if (d.kind === 'model') {
		d.m = Object.assign({}, d.m, { pos: r4v(d.state.pos), rot: r4v(d.state.rot), scale: r4(d.state.scale) })
		ueWriteDpModel(dp, d.m)
	} else {
		dp.ue_pos = r4v(d.state.pos).join(',')
		dp.ue_rot = r4v(d.state.rot).join(',')
	}
	markProjectDirty()
}
function ueRegisterTransformModule() {
	if (ue_transform_module || typeof TransformerModule === 'undefined') return
	try {
		ue_transform_module = new TransformerModule('universal_emotes_object', {
			priority: 5,
			condition: function () { return !!(ue_gizmo_target && ueInAnimateMode() && ueGizmoObject()) },
			use_condition: function () { return !!ue_gizmo_target },
			updateGizmo: function () {
				const obj = ueGizmoObject(), T = ueTHREE()
				if (!obj || !T) return false
				const v = new T.Vector3()
				obj.getWorldPosition(v)
				if (Transformer.parent) Transformer.parent.worldToLocal(v)
				Transformer.position.copy(v)
				Transformer.rotation_ref = (ueToolChannel() === 'position') ? (obj.parent || ueScene()) : obj
				return true
			},
			calculateOffset: function (context) {
				const ch = ueToolChannel()
				const ev = context.event || {}
				let value = context.point ? context.point[context.axis] : 0
				let interval = 1
				if (ch === 'rotation') {
					value = context.angle
					try { if (typeof getRotationInterval === 'function') interval = getRotationInterval(ev) } catch (e) {}
				} else if (ch === 'scale') {
					if (context.axis === 'e' && context.point) value = context.point.length()
					value *= (context.direction || 1) * 0.1
					try { interval = (typeof getSpatialInterval === 'function') ? getSpatialInterval(ev) : 1 } catch (e) { interval = 1 }
					interval *= 0.1
				} else {
					try { interval = (typeof getSpatialInterval === 'function') ? getSpatialInterval(ev) : 1 } catch (e) { interval = 1 }
				}
				if (!isFinite(value)) value = 0
				return (interval && isFinite(interval)) ? Math.round(value / interval) * interval : value
			},
			onStart: function () {
				try { if (ueIsPlaying()) Timeline.pause() } catch (e) {}
				ue_drag = null
				try { ue_drag = ueBeginGizmoEdit() } catch (e) { ueFail('Could not edit the object', e); ue_drag = null }
			},
			onMove: function (context) {
				const d = ue_drag; if (!d) return
				const ch = ueToolChannel()
				let diff = context.value - (this.previous_value || 0)
				const ax = context.axis_number
				if (ch === 'rotation') {
					if (Math.abs(diff) > 120) diff = 0
					if (ax == null || context.axis === 'e') return
					d.state.rot[ax] += diff
				} else if (ch === 'scale') {
					if (d.kind !== 'model') return
					d.state.scale = Math.max(0.01, d.state.scale + diff)
				} else {
					if (ax == null) return
					d.state.pos[ax] += diff
				}
				ueWriteDragState(d)
				try { updateParticleMarkers(false) } catch (e) {}
				try { Blockbench.setCursorTooltip(String(Math.round((context.value - (this.initial_value || 0)) * 100) / 100)) } catch (e) {}
				try { Transformer.center() } catch (e) {}
			},
			onEnd: function (context) {
				const d = ue_drag; ue_drag = null
				if (!d) return
				if (context && context.keep_changes === false) { try { Undo.cancelEdit(true) } catch (e) {} }
				else { try { Undo.finishEdit(d.kind === 'model' ? 'Move emote model' : 'Move emote effect', { keyframes: d.kfs }) } catch (e) {} }
				try { Blockbench.setCursorTooltip() } catch (e) {}
				try { if (d.kf && d.kf.select) d.kf.select() } catch (e) {}
				ueRebuildKfFields()
				try { updateParticleMarkers(false) } catch (e) {}
				ueTransformerUpdate()
			},
			onCancel: function () {
				if (ue_drag) { ue_drag = null; try { Undo.cancelEdit(true) } catch (e) {} }
				ueRebuildKfFields()
			}
		})
	} catch (e) { ueLog.warn('TransformerModule unavailable:', e); ue_transform_module = null }
}
function ueUnregisterTransformModule() {
	try { if (ue_transform_module && ue_transform_module.delete) ue_transform_module.delete() } catch (e) {}
	ue_transform_module = null
	ue_gizmo_target = null; ue_drag = null
	ueTransformerUpdate()
}
function ueRaycastTargets(pv, e) {
	const T = ueTHREE(); const cam = pv && pv.camera
	if (!T || !cam || !pv.canvas) return null
	const rect = pv.canvas.getBoundingClientRect()
	if (!rect.width || !rect.height) return null
	const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
	const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
	const rc = new T.Raycaster()
	rc.setFromCamera(new T.Vector2(x, y), cam)
	rc.camera = cam
	if (cam.isOrthographicCamera) { rc.ray.origin.set(x, y, -1).unproject(cam); rc.far = cam.far - cam.near }
	const objs = []
	for (const k in ue_model_renders) { const o = ue_model_renders[k] && ue_model_renders[k].obj; if (o && o.parent && o.visible) objs.push(o) }
	for (const k in ue_particle_markers) { const m = ue_particle_markers[k]; if (m && m.parent && m.visible) objs.push(m) }
	if (!objs.length) return null
	let hits = []
	try { hits = rc.intersectObjects(objs, true) } catch (err) { return null }
	for (const h of hits) {
		let o = h.object
		while (o) { if (o.userData && o.userData.ueTarget) return { kind: o.userData.ueTarget.kind, key: o.userData.ueTarget.key }; o = o.parent }
	}
	return null
}
function ueOnCanvasPointerDown(e) {
	try {
		if (e.button !== undefined && e.button !== 0) return
		if (!ueInAnimateMode() || typeof Preview === 'undefined' || !Preview.all) return
		const pv = Preview.all.find(function (p) { return p && p.canvas === e.target })
		if (!pv) return
		if (typeof Transformer !== 'undefined' && Transformer && Transformer.visible && Transformer.hoverAxis != null) return
		const hit = ueRaycastTargets(pv, e)
		if (hit) {
			if (typeof TransformerModule === 'undefined') {
				if (!ue_gizmo_warned) { ue_gizmo_warned = true; ueNotify('Object gizmo needs Blockbench 5 or newer', 2500) }
				return
			}
			e.stopPropagation(); e.preventDefault()
			try { Preview.selected = pv } catch (err) {}
			ueSetGizmoTarget(hit)
		} else if (ue_gizmo_target) {
			ueClearGizmoTarget()
		}
	} catch (err) {}
}
function ueOnSelectionChanged() { ueClearGizmoTarget() }
function ueOnOutlinerSelection() {
	try {
		let anySel = false
		if (typeof Outliner !== 'undefined' && Outliner.selected && Outliner.selected.length > 0) anySel = true
		if (typeof Group !== 'undefined') {
			if (Group.first_selected) anySel = true
			const gs = Group.selected
			if (Array.isArray(gs) ? gs.length > 0 : !!gs) anySel = true
		}
		if (anySel) ueClearGizmoTarget()
	} catch (e) {}
}
function ueInstallGizmo() {
	ueRegisterTransformModule()
	document.addEventListener('pointerdown', ueOnCanvasPointerDown, true)
	try {
		if (typeof Blockbench !== 'undefined' && Blockbench.on) {
			Blockbench.on('update_selection', ueOnOutlinerSelection)
			Blockbench.on('select_mode', ueOnSelectionChanged)
			Blockbench.on('select_animation', ueOnSelectionChanged)
			Blockbench.on('select_project', ueOnSelectionChanged)
		}
	} catch (e) {}
}
function ueUninstallGizmo() {
	document.removeEventListener('pointerdown', ueOnCanvasPointerDown, true)
	try {
		if (typeof Blockbench !== 'undefined' && Blockbench.removeListener) {
			Blockbench.removeListener('update_selection', ueOnOutlinerSelection)
			Blockbench.removeListener('select_mode', ueOnSelectionChanged)
			Blockbench.removeListener('select_animation', ueOnSelectionChanged)
			Blockbench.removeListener('select_project', ueOnSelectionChanged)
		}
	} catch (e) {}
	ueUnregisterTransformModule()
}

let ue_skin_saved = null
let ue_skin_current = null
function ueMainSkinTexture() {
	try {
		if (typeof Texture !== 'undefined' && Texture.all && Texture.all.length) {
			if (typeof Texture.getDefault === 'function') { const d = Texture.getDefault(); if (d) return d }
			const sel = Texture.all.find(function (x) { return x.selected }); if (sel) return sel
			return Texture.all[0]
		}
	} catch (e) {}
	return null
}
function ueTextureAssetDataUrl(assetId) {
	const a = ueFindAsset('texture', assetId)
	return (a && a.b64) ? ('data:image/png;base64,' + a.b64) : null
}
function ueSetTextureSource(tex, dataUrl) {
	try { tex.source = dataUrl } catch (e) {}
	try { if (typeof tex.fromDataURL === 'function') tex.fromDataURL(dataUrl) } catch (e) {}
	try { if (typeof tex.updateSource === 'function') tex.updateSource(dataUrl) } catch (e) {}
	try { if (typeof tex.updateImageFromSource === 'function') tex.updateImageFromSource() } catch (e) {}
	try { if (typeof tex.load === 'function') tex.load() } catch (e) {}
	try { if (typeof Canvas !== 'undefined' && Canvas.updateAllFaces) Canvas.updateAllFaces() } catch (e) {}
}
let ue_skin_swap_until = 0
function ueNow() { try { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() } catch (e) { return Date.now() } }
function ueBeginSkinSwap() {
	try { restoreAllBendGeometry() } catch (e) {}
	ue_skin_swap_until = ueNow() + 500
}
function ueEndSkinSwap() {
	try { restoreAllBendGeometry() } catch (e) {}
	try {
		setTimeout(function () {
			ue_skin_swap_until = 0
			try { restoreAllBendGeometry() } catch (e) {}
			try { if (typeof Animator !== 'undefined' && Animator.preview) Animator.preview() } catch (e) {}
		}, 550)
	} catch (e) { ue_skin_swap_until = 0 }
}
function ueApplySkin(dataUrl) {
	const tex = ueMainSkinTexture(); if (!tex || !dataUrl) return
	try { if (!ue_skin_saved || ue_skin_saved.tex !== tex) ue_skin_saved = { tex: tex, original: tex.source } } catch (e) {}
	ueBeginSkinSwap()
	ueSetTextureSource(tex, dataUrl)
	ueEndSkinSwap()
}
function ueResetSkin() {
	try {
		ueBeginSkinSwap()
		if (ue_skin_saved && ue_skin_saved.tex && ue_skin_saved.original != null) ueSetTextureSource(ue_skin_saved.tex, ue_skin_saved.original)
		ueEndSkinSwap()
	} catch (e) {}
	ue_skin_saved = null
}
function ueGatherSkinEvents() {
	const out = []
	try {
		const ea = currentEffectsAnimator()
		for (const kf of ((ea && ea.timeline) || [])) {
			const dp = (kf.data_points && kf.data_points[0]) || {}
			const t0 = round(kf.time)
			String(dp.script || dp.instructions || '').split(/\r?\n/).forEach(function (line) {
				const ev = parseInstruction(line, t0)
				if (!ev) return
				if (ev.type === 'set_skin') out.push({ time: t0, type: 'set', asset: ev.asset_id || '', model: (ev.model === 'thin' || ev.model === 'wide') ? ev.model : null })
				else if (ev.type === 'reset_skin') out.push({ time: t0, type: 'reset' })
			})
		}
	} catch (e) { ueWarnOnce('skin_events', 'reading skin instructions failed:', e) }
	out.sort(function (a, b) { return a.time - b.time })
	return out
}
function ueUpdateSkinForTime(t) {
	try {
		if (!ueInAnimateMode()) { if (ue_skin_current !== null) { ueResetSkin(); ue_skin_current = null } ueApplyArmModel('wide'); return }
		if (!ueChannelVisible('timeline')) { if (ue_skin_current !== null) { ueResetSkin(); ue_skin_current = null } ueApplyArmModel(null); return }
		const evs = ueGatherSkinEvents()
		let desired = null
		let desiredModel = null
		for (const e of evs) { if (e.time <= t + 0.001) { desired = (e.type === 'set') ? (e.asset || null) : null; desiredModel = (e.type === 'set') ? (e.model || null) : null } else break }
		if (desired !== ue_skin_current) {
			if (desired) { const url = ueTextureAssetDataUrl(desired); if (url) { ueApplySkin(url); ue_skin_current = desired } else { ueResetSkin(); ue_skin_current = null } }
			else { ueResetSkin(); ue_skin_current = null }
		}
		ueApplyArmModel(desiredModel)
	} catch (e) { ueWarnOnce('skin_preview', 'skin preview update failed:', e) }
}

let ue_skin_model_current = null
let ue_thinned_cubes = new Set()
function ueArmGroupNames() {
	return isR15()
		? ['RightUpperArm', 'RightLowerArm', 'RightHand', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand']
		: ['RightArm', 'LeftArm']
}
function ueCollectCubesDeep(group, set) {
	if (!group || !group.children) return
	for (const c of group.children) {
		if (typeof Cube !== 'undefined' && c instanceof Cube) set.add(c)
		else if (c && c.children) ueCollectCubesDeep(c, set)
	}
}
function ueArmCubes() {
	const names = ueArmGroupNames()
	const set = new Set()
	try {
		if (typeof Group !== 'undefined' && Group.all) {
			Group.all.forEach(function (g) { if (g && names.indexOf(g.name) !== -1) ueCollectCubesDeep(g, set) })
		}
	} catch (e) {}
	return Array.from(set)
}
function ueUvShift(uv, du, dw) {
	if (!uv || uv.length < 4) return uv
	return [uv[0] + du, uv[1], uv[2] + du + dw, uv[3]]
}
function ueSetCubeThin(cube, thin) {
	try {
		if (!cube.__ue_wide) {
			cube.__ue_wide = { from: cube.from.slice(), to: cube.to.slice(), faces: {} }
			for (const f in cube.faces) { if (cube.faces[f] && cube.faces[f].uv) cube.__ue_wide.faces[f] = cube.faces[f].uv.slice() }
		}
		const w = cube.__ue_wide
		cube.from = w.from.slice()
		cube.to = w.to.slice()
		for (const f in w.faces) { if (cube.faces[f]) cube.faces[f].uv = w.faces[f].slice() }
		if (thin) {
			const width = w.to[0] - w.from[0]
			if (w.from[0] >= 0) cube.to[0] = w.from[0] + (width - 1)
			else cube.from[0] = w.to[0] - (width - 1)
			if (cube.faces.north && w.faces.north) cube.faces.north.uv = ueUvShift(w.faces.north, 0, -1)
			if (cube.faces.up && w.faces.up) cube.faces.up.uv = ueUvShift(w.faces.up, 0, -1)
			if (cube.faces.west && w.faces.west) cube.faces.west.uv = ueUvShift(w.faces.west, -1, 0)
			if (cube.faces.south && w.faces.south) cube.faces.south.uv = ueUvShift(w.faces.south, -1, -1)
			if (cube.faces.down && w.faces.down) cube.faces.down.uv = ueUvShift(w.faces.down, -1, -1)
		}
	} catch (e) {}
}
function uePreviewModel() {
	try { const s = getStore(); return (s && s.preview_model === 'thin') ? 'thin' : 'wide' } catch (e) { return 'wide' }
}
function ueSetPreviewModel(model) {
	const s = getStore(); if (!s) return
	s.preview_model = (model === 'thin') ? 'thin' : 'wide'
	markProjectDirty()
	try { if (ueInAnimateMode()) ueUpdateSkinForTime(ueTime()) } catch (e) {}
	ueNotify('Preview model: ' + (s.preview_model === 'thin' ? 'Thin' : 'Wide'))
}
function ueApplyArmModel(model) {
	if (model !== 'thin' && model !== 'wide') model = uePreviewModel()
	const desired = (model === 'thin') ? 'thin' : 'wide'
	if (desired === ue_skin_model_current) return
	try {
		try { restoreAllBendGeometry() } catch (e) {}
		const cubes = ueArmCubes()
		for (const c of cubes) {
			try {
				ueSetCubeThin(c, desired === 'thin')
				if (desired === 'thin') ue_thinned_cubes.add(c); else ue_thinned_cubes.delete(c)
				if (c.mesh) { try { original_geometry_cache.delete(c.mesh) } catch (e) {} }
				if (c.preview_controller) {
					try { if (c.preview_controller.updateGeometry) c.preview_controller.updateGeometry(c) } catch (e) {}
					try { if (c.preview_controller.updateUV) c.preview_controller.updateUV(c) } catch (e) {}
				}
			} catch (e) {}
		}
		if (typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll()
		ue_skin_swap_until = ueNow() + 200
		ue_skin_model_current = desired
	} catch (e) { ueWarnOnce('arm_model', 'arm model update failed:', e) }
}

let ue_wrapped_codecs = []
function ueWithRealArms(fn, self, args) {
	const was = ue_skin_model_current
	if (was === 'thin') { try { ueApplyArmModel('wide') } catch (e) {} }
	try { return fn.apply(self, args) }
	finally { if (was === 'thin') { try { ueApplyArmModel('thin') } catch (e) {} } }
}
function ueWrapCodecs() {
	try {
		if (typeof Codecs === 'undefined') return
		for (const id in Codecs) {
			const c = Codecs[id]
			if (!c || typeof c.compile !== 'function' || c.compile.__ue_wrapped) continue
			const orig = c.compile
			const w = function () { return ueWithRealArms(orig, this, arguments) }
			w.__ue_wrapped = true; w.__ue_orig = orig
			c.compile = w
			ue_wrapped_codecs.push(c)
		}
	} catch (e) {}
}
function ueUnwrapCodecs() {
	ue_wrapped_codecs.forEach(function (c) { try { if (c.compile && c.compile.__ue_orig) c.compile = c.compile.__ue_orig } catch (e) {} })
	ue_wrapped_codecs = []
}
function ueOnUnselectProject() {
	ue_thinned_cubes.forEach(function (c) { try { ueSetCubeThin(c, false) } catch (e) {} })
	ue_thinned_cubes = new Set()
	ue_skin_model_current = null
	ue_gizmo_target = null
}
function ueOnSelectProject() {
	ue_skin_model_current = null
	setTimeout(ueEnsureItemBones, 400)
	setTimeout(ueEnsureItemBones, 2000)
}
function ueEnsureItemBones() {
	try {
		if (typeof Group === 'undefined' || !Group.all || typeof Project === 'undefined' || !Project) return
		if (!/^player_r(6|15)$/.test(String(Project.geometry_name || ''))) return
		const find = function (n) { return Group.all.find(function (g) { return g && g.name === n }) }
		const specs = [['RightItem', ['RightHand', 'RightArm'], [6, 12, -2]], ['LeftItem', ['LeftHand', 'LeftArm'], [-6, 12, -2]]]
		const todo = []
		specs.forEach(function (sp) {
			if (find(sp[0])) return
			const parent = find(sp[1][0]) || find(sp[1][1])
			if (parent) todo.push([sp[0], parent, sp[2]])
		})
		if (!todo.length) return
		Undo.initEdit({ outliner: true })
		todo.forEach(function (t) {
			const g = new Group({ name: t[0], origin: t[2].slice() }).init()
			g.addTo(t[1])
			try { g.origin = t[2].slice() } catch (e) {}
		})
		try { if (typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll() } catch (e) {}
		Undo.finishEdit('Add item bones', { outliner: true })
		markProjectDirty()
		ueNotify('Added ' + todo.map(function (t) { return t[0] }).join(' and ') + ' bone' + (todo.length > 1 ? 's' : '') + ' (held items and attached models follow the hands)', 3500)
	} catch (e) { ueWarnOnce('item_bones', 'adding item bones failed:', e) }
}

function ueKfPanelNode() { return document.getElementById('panel_keyframe') }
function ueEl(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e }
function ueFieldCss() { return 'flex:1 1 60px;min-width:0;max-width:100%;box-sizing:border-box;background:var(--color-back,#2b2b2b);border:1px solid var(--color-border,#555);border-radius:3px;color:var(--color-text,#ddd);padding:2px 4px;font-size:11px;' }
function ueNumberInput(val) {
	const comp = ueEl('div'); comp.className = 'prism-editor-component molang_input keyframe_input tab_target'
	const wrap = ueEl('div'); wrap.className = 'prism-editor-wrapper'
	const pre = ueEl('pre')
	pre.setAttribute('contenteditable', 'true')
	pre.setAttribute('spellcheck', 'false')
	pre.setAttribute('autocapitalize', 'off')
	pre.setAttribute('autocomplete', 'off')
	pre.setAttribute('autocorrect', 'off')
	pre.setAttribute('data-gramm', 'false')
	pre.className = 'prism-editor__code language-molang'
	const code = ueEl('code'); code.className = 'language-molang'
	pre.appendChild(code); wrap.appendChild(pre); comp.appendChild(wrap)
	function paint(s) {
		code.textContent = ''
		const str = (s == null ? '' : String(s))
		if (str === '') return
		const span = ueEl('span')
		span.className = /^[-+]?\d*\.?\d+$/.test(str.trim()) ? 'token number' : 'token'
		span.textContent = str
		code.appendChild(span)
	}
	Object.defineProperty(comp, 'value', {
		get() { return (pre.textContent || '').trim() },
		set(v) { paint(v) },
		configurable: true
	})
	paint(val == null ? '' : val)
	pre.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pre.blur() } })
	pre.addEventListener('blur', function () { paint(pre.textContent); comp.dispatchEvent(new Event('change', { bubbles: true })) })
	return comp
}
function ueTextInput(val) { const i = ueEl('input'); i.className = 'dark_bordered code keyframe_input tab_target'; i.type = 'text'; i.value = (val == null ? '' : val); return i }
function ueSelectInput(opts, val) { const s = ueEl('select', ueFieldCss()); s.className = 'dark_bordered focusable_input'; opts.forEach(function (o) { const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; if (o[0] === val) op.selected = true; s.appendChild(op) }); return s }
function ueDpList() {
	const panel = ueKfPanelNode(); if (!panel) return []
	return Array.prototype.slice.call(panel.querySelectorAll('ul.list > .keyframe_data_point'))
}
function ueSectionBar(txt) { const b = ueEl('div'); b.className = 'bar flex'; const l = ueEl('label', null, txt); l.className = 'undefined'; b.appendChild(l); return b }
function ueMakeSlidable(label, input) {
	label.classList.add('slidable_input')
	let dragging = false, startX = 0, startVal = 0
	function onMove(e) {
		if (!dragging) return
		const dx = e.clientX - startX
		const step = e.shiftKey ? 0.1 : (e.ctrlKey ? 0.01 : 1)
		let val = startVal + dx * step
		val = Math.round(val * 1000) / 1000
		input.value = val
		input.dispatchEvent(new Event('input', { bubbles: true }))
	}
	function onUp() {
		if (!dragging) return
		dragging = false
		document.removeEventListener('mousemove', onMove)
		document.removeEventListener('mouseup', onUp)
		input.dispatchEvent(new Event('change', { bubbles: true }))
	}
	label.addEventListener('mousedown', function (e) {
		if (e.button !== 0) return
		e.preventDefault()
		dragging = true; startX = e.clientX; startVal = parseFloat(input.value) || 0
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})
}
function ueAxisBar(axis, input) { const b = ueEl('div'); b.className = 'bar flex'; const l = ueEl('label', null, axis.toUpperCase()); l.className = 'color_' + axis + ' axis slidable_input'; ueMakeSlidable(l, input); b.appendChild(l); b.appendChild(input); return b }
function ueLabeledBar(txt, input) { const b = ueEl('div'); b.className = 'bar flex'; const l = ueEl('label', null, txt); l.className = 'undefined'; b.appendChild(l); b.appendChild(input); return b }
let ue_field_edit_end = null
function ueEndFieldEdit() { const f = ue_field_edit_end; ue_field_edit_end = null; if (f) { try { f() } catch (e) {} } }
function ueBindFields(inputs, kf, label, commit) {
	let open = false
	function begin() {
		if (open) return
		ueEndFieldEdit()
		if (typeof Undo === 'undefined' || Undo.current_save) return
		try { Undo.initEdit({ keyframes: [kf] }); open = true; ue_field_edit_end = end } catch (e) {}
	}
	function end() {
		if (!open) return
		open = false
		if (ue_field_edit_end === end) ue_field_edit_end = null
		try { Undo.finishEdit(label, { keyframes: [kf] }) } catch (e) {}
	}
	inputs.forEach(function (i) {
		i.addEventListener('input', function () { begin(); commit() })
		i.addEventListener('change', function () { begin(); commit(); end() })
	})
}
function ueClearForeignDpFields(uuid, ch) {
	const panel = ueKfPanelNode(); if (!panel) return
	const all = panel.querySelectorAll('.ue_dp_fields')
	for (let i = 0; i < all.length; i++) {
		const el = all[i]
		if (!uuid || el.dataset.ueKf !== uuid || el.dataset.ueCh !== ch) {
			ueEndFieldEdit()
			try { el.parentNode && el.parentNode.removeChild(el) } catch (e) {}
		}
	}
}
function ueAfterPreviewEdit() { try { updateParticleMarkers(ueIsPlaying()) } catch (e) {} }
function ueBuildModelDpFields(box, kf, dpn) {
	const cur = ueDpModel(dpn) || {}
	const pos = cur.pos || [0, 0, 0], rot = cur.rot || [0, 0, 0]
	const inAsset = ueTextInput(cur.asset_id || ''); inAsset.classList.add('ue_kf_asset_field'); inAsset.dataset.ueAsset = 'model'; inAsset.placeholder = 'namespace:model'
	const inTex = ueTextInput(cur.texture || ''); inTex.classList.add('ue_kf_asset_field'); inTex.dataset.ueAsset = 'texture'; inTex.placeholder = 'namespace:texture (optional)'
	const inMode = ueSelectInput([['bone', 'Bone'], ['model_root', 'Model root'], ['world', 'World']], cur.attach_mode || 'bone')
	const inBone = ueSelectInput(ueBoneOptions(cur.bone), cur.bone || '')
	const px = ueNumberInput(pos[0]), py = ueNumberInput(pos[1]), pz = ueNumberInput(pos[2])
	const rx = ueNumberInput(rot[0]), ry = ueNumberInput(rot[1]), rz = ueNumberInput(rot[2])
	const inScale = ueNumberInput(cur.scale != null ? cur.scale : 1)
	const inEnd = ueTextInput(cur.end != null ? cur.end : '')
	ueBindFields([inAsset, inTex, inMode, inBone, px, py, pz, rx, ry, rz, inScale, inEnd], kf, 'Edit model event', function () {
		ueWriteDpModel(dpn, ueModelFromValues({
			asset_id: inAsset.value, texture: inTex.value, attach_mode: inMode.value, bone: inBone.value,
			px: px.value, py: py.value, pz: pz.value, rx: rx.value, ry: ry.value, rz: rz.value,
			scale: inScale.value, end: inEnd.value
		}, (ueDpModel(dpn) || {}).track))
		markProjectDirty()
		ueAfterPreviewEdit()
	})
	box.appendChild(ueLabeledBar('Asset', inAsset))
	box.appendChild(ueLabeledBar('Texture', inTex))
	box.appendChild(ueLabeledBar('Attach', inMode))
	box.appendChild(ueLabeledBar('Bone', inBone))
	if (cur.track) {
		const info = ueEl('span', 'flex:1 1 auto;font-size:11px;opacity:.75;', 'Linked to previous frame')
		const btn = ueEl('button', null, 'Unlink'); btn.className = 'tool'
		btn.style.cssText = 'font-size:11px;padding:1px 8px;cursor:pointer;'
		btn.title = 'Make this data point an independent model again'
		btn.addEventListener('click', function (e) {
			e.preventDefault()
			ueEndFieldEdit()
			try {
				ueEditKeyframes([kf], 'Unlink model keyframe', function () { const now = ueDpModel(dpn) || {}; delete now.track; ueWriteDpModel(dpn, now) })
			} catch (err) { ueFail('Could not unlink the model', err); return }
			ueAfterPreviewEdit()
			ueRebuildKfFields()
			ueNotify('Model unlinked')
		})
		const b = ueEl('div'); b.className = 'bar flex'
		const l = ueEl('label', null, 'Link'); l.className = 'undefined'
		b.appendChild(l); b.appendChild(info); b.appendChild(btn)
		box.appendChild(b)
	}
	box.appendChild(ueSectionBar('Position'))
	box.appendChild(ueAxisBar('x', px)); box.appendChild(ueAxisBar('y', py)); box.appendChild(ueAxisBar('z', pz))
	box.appendChild(ueSectionBar('Rotation'))
	box.appendChild(ueAxisBar('x', rx)); box.appendChild(ueAxisBar('y', ry)); box.appendChild(ueAxisBar('z', rz))
	box.appendChild(ueLabeledBar('Scale', inScale))
	box.appendChild(ueLabeledBar('End', inEnd))
}
function ueBuildInstructionDpFields(box, kf, dpn) {
	box.appendChild(ueSectionBar('Instruction'))
	const ta = ueEl('textarea')
	ta.className = 'dark_bordered code keyframe_input tab_target ue_kf_script_field'
	ta.style.cssText = 'width:100%;min-height:66px;font-family:monospace;resize:vertical;line-height:1.4;box-sizing:border-box;'
	ta.value = dpn.script || ''
	ta.spellcheck = false
	ta.placeholder = 'set_skin <texture> [auto|thin|wide|default]\nreset_skin'
	ueBindFields([ta], kf, 'Edit instruction', function () { dpn.script = ta.value; markProjectDirty() })
	const row = ueEl('div'); row.className = 'bar flex'
	row.appendChild(ta)
	box.appendChild(row)
}
function ueBuildParticleDpFields(box, kf, dpn) {
	const tr = readEffectTransform(kf, dpn)
	const pos = tr.pos || [0, 0, 0], rot = tr.rot || [0, 0, 0]
	const px = ueNumberInput(pos[0]), py = ueNumberInput(pos[1]), pz = ueNumberInput(pos[2])
	const rx = ueNumberInput(rot[0]), ry = ueNumberInput(rot[1]), rz = ueNumberInput(rot[2])
	const inBone = ueSelectInput(ueBoneOptions(dpn.locator), dpn.locator || '')
	inBone.title = 'Bone: the particle spawns at this bone and follows its animation. Position is then relative to the bone pivot. Empty = relative to the player.'
	ueBindFields([inBone, px, py, pz, rx, ry, rz], kf, 'Edit particle transform', function () {
		dpn.locator = inBone.value || ''
		dpn.ue_pos = [numOr(px.value, 0), numOr(py.value, 0), numOr(pz.value, 0)].join(',')
		dpn.ue_rot = [numOr(rx.value, 0), numOr(ry.value, 0), numOr(rz.value, 0)].join(',')
		markProjectDirty()
		ueAfterPreviewEdit()
	})
	box.appendChild(ueLabeledBar('Bone', inBone))
	box.appendChild(ueSectionBar('Position'))
	box.appendChild(ueAxisBar('x', px)); box.appendChild(ueAxisBar('y', py)); box.appendChild(ueAxisBar('z', pz))
	box.appendChild(ueSectionBar('Rotation'))
	box.appendChild(ueAxisBar('x', rx)); box.appendChild(ueAxisBar('y', ry)); box.appendChild(ueAxisBar('z', rz))
}
function ueBuildSoundDpFields(box, kf, dpn) {
	const vp = readSoundParams(kf, dpn)
	const inType = ueSelectInput([['sound', 'Sound'], ['music', 'Music']], ueSoundType(kf, dpn))
	inType.title = 'Sound: a one-shot sound effect (play_sound). Music: the emote\'s music track (play_music).'
	const inVol = ueNumberInput(vp.volume), inPitch = ueNumberInput(vp.pitch)
	const inDmca = ueEl('input')
	inDmca.type = 'text'
	inDmca.className = 'dark_bordered keyframe_input tab_target'
	inDmca.style.cssText = 'width:100%;box-sizing:border-box;'
	inDmca.value = dpn.ue_dmca || ''
	inDmca.placeholder = 'empty | true | namespace:alternative'
	inDmca.title = 'DMCA: leave empty for a copyright-free sound. "true": copyrighted, muted in the players\' DMCA mode. ' +
		'An asset id (namespace:path): copyrighted, that sound plays instead in DMCA mode.'
	const pitchBar = ueLabeledBar('Pitch', inPitch)
	function syncPitch() { pitchBar.style.display = inType.value === 'music' ? 'none' : '' }
	ueBindFields([inType, inVol, inPitch, inDmca], kf, 'Edit sound settings', function () {
		dpn.ue_sound_type = inType.value === 'music' ? 'music' : 'sound'
		dpn.ue_volume = numOr(inVol.value, 1); dpn.ue_pitch = numOr(inPitch.value, 1)
		dpn.ue_dmca = inDmca.value.trim() || undefined
		syncPitch()
		markProjectDirty()
	})
	syncPitch()
	box.appendChild(ueLabeledBar('Type', inType))
	box.appendChild(ueLabeledBar('Volume', inVol)); box.appendChild(pitchBar)
	box.appendChild(ueLabeledBar('DMCA', inDmca))
}
const UE_DP_BUILDERS = { models: ueBuildModelDpFields, timeline: ueBuildInstructionDpFields, particle: ueBuildParticleDpFields, sound: ueBuildSoundDpFields }
function ueInjectDataPointFields(kf, ch) {
	const build = UE_DP_BUILDERS[ch]; if (!build) return
	const dps = ueDpList(); if (!dps.length) return
	if (!kf.data_points) kf.data_points = []
	dps.forEach(function (dpEl, di) {
		try { dpEl.style.maxHeight = 'none' } catch (e) {}
		const existing = dpEl.querySelector(':scope > .ue_dp_fields')
		if (existing) {
			if (existing.dataset.ueKf === (kf.uuid || '') && existing.dataset.ueCh === ch) return
			try { existing.parentNode.removeChild(existing) } catch (e) {}
		}
		if (!kf.data_points[di]) kf.data_points[di] = ueNewDataPoint(kf)
		const box = ueEl('div'); box.className = 'ue_dp_fields'
		box.dataset.ueKf = kf.uuid || ''
		box.dataset.ueCh = ch
		build(box, kf, kf.data_points[di])
		dpEl.appendChild(box)
	})
}
function ueEnsureKfStyles() {
	if (document.getElementById('ue_kf_styles')) return
	const s = document.createElement('style')
	s.id = 'ue_kf_styles'
	s.textContent = [
		'#panel_keyframe { display:flex; flex-direction:column; min-height:0; }',
		'#panel_keyframe .panel_vue_wrapper { flex:1 1 auto; display:flex; flex-direction:column; min-height:0; }',
		'#panel_keyframe ul.list { flex:1 1 auto; min-height:0; overflow-y:auto !important; }',
		'#panel_keyframe ul.list > .keyframe_data_point { max-height:none !important; }',
		'#panel_keyframe .keyframe_data_point_header { position:relative; z-index:2; background:var(--color-ui, var(--color-back, #2b2b2b)); }',
		'#panel_keyframe .ue_dp_fields { display:block; width:100%; box-sizing:border-box; clear:both; margin-top:3px; padding-top:2px; border-top:1px solid var(--color-border, #444); }',
		'#panel_keyframe .ue_dp_fields .bar.flex { margin:2px 0; position:relative; z-index:0; }',
		'#panel_keyframe .ue_dp_fields .slidable_input { cursor:ew-resize; }',
		'#panel_keyframe .ue_dp_fields .prism-editor-component { flex:1 1 auto; min-width:0; }'
	].join('\n')
	document.head.appendChild(s)
}
function refreshKfPanel() {
	if (!ueKfPanelNode()) return
	try { ueEnsureKfStyles() } catch (e) {}
	const kf = ueSelectedKeyframe()
	const ch = kf ? kf.channel : null
	ueAfterPreviewEdit()
	if (!kf || !UE_DP_BUILDERS[ch]) { ueClearForeignDpFields(null, null); return }
	ueClearForeignDpFields(kf.uuid || '', ch)
	try { ueInjectDataPointFields(kf, ch) } catch (e) { ueWarnOnce('dp_inject', 'keyframe panel field injection failed:', e) }
}
function ueRebuildKfFields() {
	ueClearForeignDpFields(null, null)
	try { refreshKfPanel() } catch (e) { ueWarnOnce('kf_refresh', 'keyframe panel refresh failed:', e) }
}
function installKfPanel() {
	refreshKfPanel()
	try { if (typeof Blockbench !== 'undefined' && Blockbench.on) Blockbench.on('update_keyframe_selection', refreshKfPanel) } catch (e) {}
	try {
		const panel = ueKfPanelNode()
		if (panel && typeof MutationObserver !== 'undefined') {
			const allNodesOurs = function (nodes) {
				for (let ni = 0; ni < nodes.length; ni++) {
					const n = nodes[ni]
					if (!(n.classList && n.classList.contains('ue_dp_fields'))) return false
				}
				return true
			}
			ue_kf_observer = new MutationObserver(function (muts) {
				let relevant = false
				for (let mi = 0; mi < muts.length; mi++) {
					const m = muts[mi]; const t = m.target
					if (t && t.nodeType === 1 && t.closest && t.closest('.ue_dp_fields')) continue
					const added = m.addedNodes || [], removed = m.removedNodes || []
					if ((added.length || removed.length) && allNodesOurs(added) && allNodesOurs(removed)) continue
					relevant = true; break
				}
				if (!relevant || ue_kf_refresh_raf) return
				const raf = (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : function (f) { return setTimeout(f, 16) }
				ue_kf_refresh_raf = raf(function () { ue_kf_refresh_raf = 0; try { refreshKfPanel() } catch (e) { ueWarnOnce('kf_refresh', 'keyframe panel refresh failed:', e) } })
			})
			ue_kf_observer.observe(panel, { childList: true, subtree: true })
		}
	} catch (e) { ueLog.warn('keyframe panel observer unavailable:', e) }
}
function uninstallKfPanel() {
	ueEndFieldEdit()
	try { if (typeof Blockbench !== 'undefined' && Blockbench.removeListener) Blockbench.removeListener('update_keyframe_selection', refreshKfPanel) } catch (e) {}
	try { if (ue_kf_observer) { ue_kf_observer.disconnect(); ue_kf_observer = null } } catch (e) {}
	ueClearForeignDpFields(null, null)
	try { const st = document.getElementById('ue_kf_styles'); if (st) st.remove() } catch (e) {}
}

function buildAnimationJSON(anim, skipped) {
	const bones = {}
	for (const uuid in anim.animators) {
		const animator = anim.animators[uuid]
		if (!animator.group) continue
		const boneName = animator.name
		const boneObj = {}

		if (skipped && animator.scale && animator.scale.length) skipped.push(emoteMeta(anim).id + ' / ' + boneName)
		const channels = isR15() ? ['rotation', 'position'] : ['rotation', 'position', 'bend']
		for (const channel of channels) {
			const kfs = animator[channel]
			if (!kfs || !kfs.length) continue
			const map = {}
			for (const kf of kfs.slice().sort((a, b) => a.time - b.time)) {
				const t = String(round(kf.time))
				const vals = ueBedrockValues(kf, channel, readKF(kf))
				const mode = mapLerpMode(kf)
				if (channel === 'bend') {
					const vec = [num(vals[0]), num(vals[1] || 0)]
					map[t] = mode === 'linear' ? vec : { vector: vec, lerp_mode: mode }
				} else {
					const vec = [num(vals[0]), num(vals[1]), num(vals[2])]
					map[t] = mode === 'linear' ? vec : { vector: vec, lerp_mode: mode }
				}
			}
			boneObj[channel] = map
		}
		if (Object.keys(boneObj).length) bones[boneName] = boneObj
	}

	const animName = emoteAnimationId(anim)
	const out = { format_version: '1.8.0', animations: {} }
	out.animations[animName] = {
		loop: anim.loop === 'loop' ? true : (anim.loop === 'hold' ? 'hold_on_last_frame' : false),
		animation_length: round(anim.length),
		bones: bones
	}
	const loopStart = ueLoopStart(anim)
	if (loopStart > 0) out.animations[animName].loop_start = round(loopStart)
	return out
}

let ue_bedrock_flip = null
function ueNum(v) { const n = Number(v); return isFinite(n) ? n : NaN }
function ueCompiledArray(out) {
	if (Array.isArray(out)) return out
	if (out && Array.isArray(out.pre)) return out.pre
	if (out && Array.isArray(out.post)) return out.post
	return null
}
function ueProbeBedrockFlip(kf, axis) {
	if (!kf || typeof kf.compileBedrockKeyframe !== 'function' || typeof kf.getArray !== 'function') return null
	let raw, out
	try { raw = ueNum(kf.getArray(0)[axis]); out = ueCompiledArray(kf.compileBedrockKeyframe()) } catch (e) { return null }
	if (!out || !isFinite(raw) || Math.abs(raw) < 1e-6) return null
	const comp = ueNum(out[axis])
	if (!isFinite(comp)) return null
	if (Math.abs(comp + raw) < 1e-4) return true
	if (Math.abs(comp - raw) < 1e-4) return false
	return null
}
function ueBedrockFlips() {
	if (ue_bedrock_flip !== null) return ue_bedrock_flip
	const probes = [['rotation', 0], ['rotation', 1], ['position', 0]]
	try {
		const anims = (typeof Animation !== 'undefined' && Animation.all) ? Animation.all : []
		for (const anim of anims) {
			for (const uuid in (anim.animators || {})) {
				const animator = anim.animators[uuid]
				for (const pr of probes) {
					for (const kf of (animator[pr[0]] || [])) {
						const r = ueProbeBedrockFlip(kf, pr[1])
						if (r !== null) { ue_bedrock_flip = r; return r }
					}
				}
			}
		}
	} catch (e) {}
	return false
}
function ueBedrockValues(kf, channel, vals) {
	if ((channel !== 'rotation' && channel !== 'position') || !ueBedrockFlips()) return vals
	const out = vals.slice()
	out[0] = -num(out[0])
	if (channel === 'rotation') out[1] = -num(out[1])
	return out
}

function readKF(kf) {
	try {
		if (kf.getArray) return kf.getArray()
		const dp = kf.data_points && kf.data_points[0]
		if (dp) return [parseFloat(dp.x) || 0, parseFloat(dp.y) || 0, parseFloat(dp.z) || 0]
	} catch (e) {}
	return [kf.x || 0, kf.y || 0, kf.z || 0]
}
function num(v) { return numOr(v, 0) }

function mapLerpMode(kf) {
	const interp = kf && kf.interpolation
	if (interp === 'catmullrom' || interp === 'smooth') return 'catmullrom'
	if (interp === 'step') return 'step'
	if (interp === 'bezier') return 'catmullrom'
	return 'linear'
}

async function exportBundle() {
	if (!ueRequireAnimations()) return
	const store = getStore()
	if (typeof JSZip === 'undefined') { ueFail('Export failed: JSZip is not available'); return }
	const seen = {}, dups = []
	Animation.all.forEach(function (anim) { const id = emoteMeta(anim).id; if (seen[id]) dups.push(id); seen[id] = true })
	if (dups.length) { ueFail('Export cancelled: duplicate emote id(s): ' + ueUniq(dups).join(', ')); return }

	const zip = new JSZip()

	const pack = {
		schema_version: 1,
		min_mod_version: store.pack.min_mod_version,
		bundle: {
			namespace: store.pack.namespace,
			id: store.pack.id,
			title: store.pack.title,
			author: store.pack.author,
			version: store.pack.version,
			description: store.pack.description,
			rig_type: store.pack.rig_type || 'r6'
		}
	}
	zip.file('pack.json', JSON.stringify(pack, null, 2))

	if (store.icon_data_url) {
		zip.file('icon.png', dataUrlToBase64(store.icon_data_url), { base64: true })
	}

	const emotesFolder = zip.folder('emotes')
	const assetsFolder = zip.folder('assets')
	const neededAssets = {}
	const skippedScale = []

	for (const anim of Animation.all) {
		const meta = emoteMeta(anim)
		const dir = emotesFolder.folder(meta.id)

		dir.file('animation.json', JSON.stringify(buildAnimationJSON(anim, skippedScale), null, 2))

		const info = {
			id: meta.id,
			animation: emoteAnimationId(anim),
			name: emoteDisplayName(meta.name) || emoteDisplayName(anim.name) || meta.id,
			description: meta.description,
			op: meta.op | 0,
			rarity: meta.rarity
		}
		dir.file('info.json', JSON.stringify(info, null, 2))

		const events = extractEvents(anim)
		dir.file('events.json', JSON.stringify({ events: events }, null, 2))

		for (const ev of events) {
			if (ev.asset_id && !ev.asset_id.startsWith('minecraft:')) neededAssets[ev.asset_id] = ev.type
			if (typeof ev.dmca === 'string' && !ev.dmca.startsWith('minecraft:')) neededAssets[ev.dmca] = ev.type
		}
	}

	const written = writeEmbeddedAssets(assetsFolder, store)
	const copyReport = await copyAssets(neededAssets, assetsFolder, store, written)

	const blob = await zip.generateAsync({ type: 'blob' })
	const filename = (store.pack.id || 'emote_bundle') + '.zip'
	downloadBlob(blob, filename)

	const lines = [
		'File: ' + filename,
		'Emotes: ' + Animation.all.length,
		'Assets included: ' + copyReport.copied.length
	]
	if (copyReport.missing.length) lines.push('', 'Missing assets (not in Emote Assets or the source folder):', copyReport.missing.join('\n'))
	if (skippedScale.length) lines.push('', 'Scale keyframes are not supported by the mod and were not exported:', skippedScale.join('\n'))
	try { Blockbench.showMessageBox({ title: 'Export Emote Bundle', message: lines.join('\n') }) } catch (e) { ueNotify('Bundle exported: ' + filename) }
}

const ASSET_KIND = {
	play_music: { dir: 'audio', ext: '.ogg' },
	play_sound: { dir: 'audio', ext: '.ogg' },
	render_model: { dir: 'models', ext: '.json' },
	set_skin: { dir: 'textures', ext: '.png' }
}

async function copyAssets(neededAssets, assetsFolder, store, written) {
	written = written || new Set()
	const copied = [], missing = []
	let fs = null, path = null
	try { if (typeof require === 'function') { fs = require('fs'); path = require('path') } } catch (e) {}

	for (const asset_id in neededAssets) {
		if (written.has(asset_id)) { copied.push(asset_id); continue }
		const type = neededAssets[asset_id]
		const kind = ASSET_KIND[type] || { dir: 'models', ext: '' }

		const base = asset_id.split(':').pop()
		const fileName = base + kind.ext

		if (fs && store.assets_source_dir) {

			const found = findFileRecursive(fs, path, store.assets_source_dir, base, kind.ext)
			if (found) {
				const buf = fs.readFileSync(found)
				assetsFolder.folder(kind.dir).file(fileName, buf)
				copied.push(asset_id)
				continue
			}
		}
		missing.push(asset_id)
	}
	return { copied, missing }
}

function findFileRecursive(fs, path, dir, base, ext) {
	let result = null
	function walk(d) {
		if (result) return
		let entries
		try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
		for (const e of entries) {
			if (result) return
			const full = path.join(d, e.name)
			if (e.isDirectory()) walk(full)
			else {
				const nm = e.name.toLowerCase()
				if (nm === (base + ext).toLowerCase() || nm.startsWith(base.toLowerCase() + '.')) {
					result = full
				}
			}
		}
	}
	walk(dir)
	return result
}

function dataUrlToBase64(url) { return String(url).split(',').pop() }
function downloadBlob(blob, filename) {
	if (typeof Blockbench !== 'undefined' && Blockbench.export) {
		const reader = new FileReader()
		reader.onerror = function () { ueFail('Export failed: could not read the bundle data', reader.error) }
		reader.onload = function () {
			Blockbench.export({
				type: 'Emote Bundle', extensions: ['zip'], name: filename,
				content: reader.result, savetype: 'zip'
			})
		}
		reader.readAsArrayBuffer(blob)
		return
	}
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob); a.download = filename; a.click()
}

function openSettingsDialog() {
	const store = ueRequireStore()
	if (!store) return

	const rig_type = (store.pack.rig_type === 'r15') ? 'r15' : 'r6'
	const form = {
		sec_bundle: { type: 'label', label: '=== Bundle (pack.json) ===' },
		rig_type_display: { type: 'info', label: 'Rig Type', text:
			'<div style="display:flex;gap:18px;align-items:center;cursor:not-allowed;user-select:none;">'
			+ '<label style="display:flex;gap:5px;align-items:center;"><input type="radio" name="ue_rig_type_ro" disabled ' + (rig_type === 'r15' ? 'checked' : '') + '> R15</label>'
			+ '<label style="display:flex;gap:5px;align-items:center;"><input type="radio" name="ue_rig_type_ro" disabled ' + (rig_type === 'r6' ? 'checked' : '') + '> R6</label>'
			+ '<span style="opacity:0.55;font-size:11px;margin-left:6px;">locked \u2014 create a new project to change</span>'
			+ '</div>'
		},
		author: { label: 'Developer (author)', type: 'text', value: store.pack.author },
		title: { label: 'Bundle Name (title)', type: 'text', value: store.pack.title },
		namespace: { label: 'Namespace', type: 'text', value: store.pack.namespace },
		id: { label: 'Bundle ID', type: 'text', value: store.pack.id },
		version: { label: 'Version', type: 'text', value: store.pack.version },
		description: { label: 'Description', type: 'textarea', value: store.pack.description },
		min_mod_version: { label: 'Min. Mod Version', type: 'select', value: store.pack.min_mod_version, options: optsFromList(MOD_VERSIONS) },
		icon: { label: 'Icon (icon.png)', type: 'file', extensions: ['png'], readtype: 'image', filetype: 'PNG' },
		assets_source_dir: { label: 'Asset Source Folder (optional fallback)', type: 'folder', value: store.assets_source_dir }
	}

	new Dialog({
		id: 'universal_emotes_settings',
		title: 'Bundle Settings',
		form: form,
		onConfirm: function () {
			const r = this.getFormResult()
			store.pack.author = r.author
			store.pack.title = r.title
			store.pack.namespace = ueJavaSafeSegment(String(r.namespace || '').trim()) || 'universal_emotes'
			store.pack.id = slugifyBase(r.id || 'my_pack')
			store.pack.version = r.version
			store.pack.description = r.description
			store.pack.min_mod_version = r.min_mod_version
			if (r.assets_source_dir) store.assets_source_dir = r.assets_source_dir
			if (r.icon) store.icon_data_url = (typeof r.icon === 'object' ? r.icon.content : r.icon)
			markProjectDirty()
			try { refreshAssetsPanel() } catch (e) {}
			this.hide()
			ueNotify('Bundle settings saved')
		}
	}).show()
}

function emoteMetaForm(meta) {
	return {
		id: { label: 'ID', type: 'text', value: meta.id },
		name: { label: 'Name', type: 'text', value: meta.name },
		description: { label: 'Description', type: 'textarea', value: meta.description },
		op: { label: 'OP Level', type: 'number', value: meta.op, min: 0, max: 4 },
		rarity: { label: 'Rarity', type: 'select', value: meta.rarity, options: optsFromList(RARITIES) }
	}
}
function applyEmoteMeta(meta, r) {
	meta.id = slugifyBase(r.id || meta.id)
	meta.name = emoteDisplayName(r.name) || meta.name
	meta.description = r.description || ''
	meta.op = Math.max(0, Math.min(4, r.op | 0))
	meta.rarity = (RARITIES.indexOf(r.rarity) !== -1) ? r.rarity : 'common'
}
function openEmoteDialogFor(anim) {
	if (!ueRequireStore()) return
	if (!anim) { ueNotify(UE_MSG.NO_ANIMATION_SELECTED); return }
	const meta = emoteMeta(anim)
	const form = emoteMetaForm(meta)
	form.loop_start = { label: 'Loop Start (s)', type: 'number', value: ueRawLoopStart(anim), min: 0, step: 0.05,
		description: 'Looping emotes: 0 - this time plays once as an intro, then the rest repeats. 0 = the whole animation loops. Also editable with the handle above the timeline.' }
	new Dialog({
		id: 'universal_emotes_single',
		title: 'Emote Settings - ' + (anim.name || 'Emote'),
		form: form,
		onConfirm: function () {
			const r = this.getFormResult()
			applyEmoteMeta(meta, r)
			if (Math.abs((Number(r.loop_start) || 0) - ueRawLoopStart(anim)) > 1e-6) ueSetLoopStart(anim, r.loop_start, 'Change loop start')
			markProjectDirty()
			this.hide()
			ueNotify('Emote info saved')
		}
	}).show()
}

function optsFromList(list) { const o = {}; list.forEach(v => o[v] = v); return o }

let emote_file_separator = null

function getEmoteFileSeparator() {
	if (emote_file_separator) return emote_file_separator
	if (typeof MenuSeparator !== 'undefined') {
		try {
			emote_file_separator = new MenuSeparator('universal_emotes_file', 'Universal Emotes')
			try { emote_file_separator.id = 'universal_emotes_file'; emote_file_separator.label = 'Universal Emotes' } catch (e) {}
			try { emote_file_separator.condition = function () { return typeof Project !== 'undefined' && !!Project } } catch (e) {}
		} catch (e) { emote_file_separator = null }
	}
	return emote_file_separator
}

function placeFileMenuActions() {
	const ids = ['universal_emotes_settings_action', 'export_bundle_action']
	let fileMenu = null
	try { fileMenu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.file : null } catch (e) {}
	if (!fileMenu || !Array.isArray(fileMenu.structure)) {
		try { MenuBar.addAction(settings_action, 'file'); MenuBar.addAction(export_action, 'file') } catch (e) {}
		return
	}
	const struct = fileMenu.structure

	for (let i = struct.length - 1; i >= 0; i--) {
		const it = struct[i]
		if (typeof it === 'string' && ids.indexOf(it) !== -1) { struct.splice(i, 1); continue }
		if (it && typeof it === 'object' && (it === emote_file_separator || it.id === 'universal_emotes_file')) struct.splice(i, 1)
	}

	let idx = -1
	for (let j = 0; j < struct.length; j++) {
		const item = struct[j]
		let label = ''
		if (typeof item === 'string') {
			const bi = (typeof BarItems !== 'undefined') ? BarItems[item] : null
			label = bi ? (bi.name || bi.id || item) : item
		} else if (item && typeof item === 'object') {
			label = item.name || item.id || ''
		}
		if (String(label).toLowerCase().indexOf('download archive') !== -1) { idx = j; break }
	}
	const sep = getEmoteFileSeparator()
	const insertItems = [sep || '_', ids[0], ids[1]]
	if (idx === -1) struct.push.apply(struct, insertItems)
	else struct.splice.apply(struct, [idx + 1, 0].concat(insertItems))
	try {
		if (typeof MenuBar !== 'undefined' && MenuBar.update) MenuBar.update()
		else if (fileMenu.updateStructure) fileMenu.updateStructure()
	} catch (e) {}
}

let emote_anim_separator = null
function getEmoteAnimSeparator() {
	if (emote_anim_separator) return emote_anim_separator
	if (typeof MenuSeparator !== 'undefined') {
		try {
			emote_anim_separator = new MenuSeparator('universal_emotes_animation', 'Universal Emotes')
			try { emote_anim_separator.id = 'universal_emotes_animation'; emote_anim_separator.label = 'Universal Emotes' } catch (e) {}
			try { emote_anim_separator.condition = function () { return typeof Project !== 'undefined' && !!Project } } catch (e) {}
		} catch (e) { emote_anim_separator = null }
	}
	return emote_anim_separator
}
function stripAnimationMenuEntries(struct) {
	for (let i = struct.length - 1; i >= 0; i--) {
		const it = struct[i]
		if (it === 'ue_preview_model' || it === preview_model_action) { struct.splice(i, 1); continue }
		if (it && typeof it === 'object' && (it === emote_anim_separator || it.id === 'universal_emotes_animation')) struct.splice(i, 1)
	}
}
function placeAnimationMenuActions() {
	let menu = null
	try { menu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.animation : null } catch (e) {}
	if (!menu || !Array.isArray(menu.structure)) {
		try { MenuBar.addAction(preview_model_action, 'animation') } catch (e) {}
		return
	}
	stripAnimationMenuEntries(menu.structure)
	menu.structure.push(getEmoteAnimSeparator() || '_', 'ue_preview_model')
	try {
		if (typeof MenuBar !== 'undefined' && MenuBar.update) MenuBar.update()
		else if (menu.updateStructure) menu.updateStructure()
	} catch (e) {}
}
function removeAnimationMenuActions() {
	try {
		const menu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.animation : null
		if (menu && Array.isArray(menu.structure)) stripAnimationMenuEntries(menu.structure)
	} catch (e) {}
	try { if (emote_anim_separator && emote_anim_separator.delete) emote_anim_separator.delete() } catch (e) {}
	emote_anim_separator = null
	try { if (typeof MenuBar !== 'undefined' && MenuBar.update) MenuBar.update() } catch (e) {}
}

function removeFileMenuActions() {
	try {
		const fileMenu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.file : null
		if (fileMenu && Array.isArray(fileMenu.structure)) {
			const struct = fileMenu.structure
			const ids = ['universal_emotes_settings_action', 'export_bundle_action']
			for (let i = struct.length - 1; i >= 0; i--) {
				const it = struct[i]
				if (typeof it === 'string' && ids.indexOf(it) !== -1) { struct.splice(i, 1); continue }
				if (it && typeof it === 'object' && (it === emote_file_separator || it.id === 'universal_emotes_file')) struct.splice(i, 1)
			}
		}
	} catch (e) {}
	try { if (emote_file_separator && emote_file_separator.delete) emote_file_separator.delete() } catch (e) {}
	emote_file_separator = null
	try { if (typeof MenuBar !== 'undefined' && MenuBar.update) MenuBar.update() } catch (e) {}
}


const EMOTE_MODEL_TEX = [64, 64]
const EMOTE_MODEL_BONES = [
	{ name: 'Root', pivot: [0, 12, 0], parent: null, cubes: [] },
	{ name: 'Torso', pivot: [0, 24, 0], parent: 'Root', cubes: [
		{ origin: [-4, 12, -2], size: [8, 12, 4], inflate: 0.25, uv: { north: [[20, 36], [8, 12]], east: [[16, 36], [4, 12]], south: [[32, 36], [8, 12]], west: [[28, 36], [4, 12]], up: [[20, 32], [8, 4]], down: [[28, 36], [8, -4]] } },
		{ origin: [-4, 12, -2], size: [8, 12, 4], uv: { north: [[20, 20], [8, 12]], east: [[16, 20], [4, 12]], south: [[32, 20], [8, 12]], west: [[28, 20], [4, 12]], up: [[20, 16], [8, 4]], down: [[28, 20], [8, -4]] } }
	] },
	{ name: 'Head', pivot: [0, 24, 0], parent: 'Root', cubes: [
		{ origin: [-4, 24, -4], size: [8, 8, 8], uv: { north: [[8, 8], [8, 8]], east: [[0, 8], [8, 8]], south: [[24, 8], [8, 8]], west: [[16, 8], [8, 8]], up: [[8, 0], [8, 8]], down: [[16, 8], [8, -8]] } },
		{ origin: [-4, 24, -4], size: [8, 8, 8], inflate: 0.25, uv: { north: [[40, 8], [8, 8]], east: [[32, 8], [8, 8]], south: [[56, 8], [8, 8]], west: [[48, 8], [8, 8]], up: [[40, 0], [8, 8]], down: [[48, 8], [8, -8]] } }
	] },
	{ name: 'RightArm', pivot: [5, 22, 0], parent: 'Root', cubes: [
		{ origin: [4, 12, -2], size: [4, 12, 4], uv: { north: [[44, 20], [4, 12]], east: [[40, 20], [4, 12]], south: [[52, 20], [4, 12]], west: [[48, 20], [4, 12]], up: [[44, 16], [4, 4]], down: [[48, 20], [4, -4]] } },
		{ origin: [4, 12, -2], size: [4, 12, 4], inflate: 0.25, uv: { north: [[44, 36], [4, 12]], east: [[40, 36], [4, 12]], south: [[52, 36], [4, 12]], west: [[48, 36], [4, 12]], up: [[44, 32], [4, 4]], down: [[48, 36], [4, -4]] } }
	] },
	{ name: 'RightItem', pivot: [6, 12, -2], parent: 'RightArm', cubes: [] },
	{ name: 'LeftArm', pivot: [-5, 22, 0], parent: 'Root', cubes: [
		{ origin: [-8, 12, -2], size: [4, 12, 4], uv: { north: [[36, 52], [4, 12]], east: [[32, 52], [4, 12]], south: [[44, 52], [4, 12]], west: [[40, 52], [4, 12]], up: [[36, 48], [4, 4]], down: [[40, 52], [4, -4]] } },
		{ origin: [-8, 12, -2], size: [4, 12, 4], inflate: 0.25, uv: { north: [[52, 52], [4, 12]], east: [[48, 52], [4, 12]], south: [[60, 52], [4, 12]], west: [[56, 52], [4, 12]], up: [[52, 48], [4, 4]], down: [[56, 52], [4, -4]] } }
	] },
	{ name: 'LeftItem', pivot: [-6, 12, -2], parent: 'LeftArm', cubes: [] },
	{ name: 'RightLeg', pivot: [2, 12, 0], parent: 'Root', cubes: [
		{ origin: [0, 0, -2], size: [4, 12, 4], uv: { north: [[4, 20], [4, 12]], east: [[0, 20], [4, 12]], south: [[12, 20], [4, 12]], west: [[8, 20], [4, 12]], up: [[4, 16], [4, 4]], down: [[8, 20], [4, -4]] } },
		{ origin: [0, 0, -2], size: [4, 12, 4], inflate: 0.25, uv: { north: [[4, 36], [4, 12]], east: [[0, 36], [4, 12]], south: [[12, 36], [4, 12]], west: [[8, 36], [4, 12]], up: [[4, 32], [4, 4]], down: [[8, 36], [4, -4]] } }
	] },
	{ name: 'LeftLeg', pivot: [-2, 12, 0], parent: 'Root', cubes: [
		{ origin: [-4, 0, -2], size: [4, 12, 4], uv: { north: [[20, 52], [4, 12]], east: [[16, 52], [4, 12]], south: [[28, 52], [4, 12]], west: [[24, 52], [4, 12]], up: [[20, 48], [4, 4]], down: [[24, 52], [4, -4]] } },
		{ origin: [-4, 0, -2], size: [4, 12, 4], inflate: 0.25, uv: { north: [[4, 52], [4, 12]], east: [[0, 52], [4, 12]], south: [[12, 52], [4, 12]], west: [[8, 52], [4, 12]], up: [[4, 48], [4, 4]], down: [[8, 52], [4, -4]] } }
	] }
]

const R15_GEO = {"format_version":"1.12.0","minecraft:geometry":[{"description":{"identifier":"geometry.player_r15","texture_width":64,"texture_height":64,"visible_bounds_width":3,"visible_bounds_height":3.5,"visible_bounds_offset":[0,1.25,0]},"bones":[{"name":"Root","pivot":[0,12,0]},{"name":"LowerTorso","pivot":[0,12,0],"parent":"Root","cubes":[{"origin":[-4,12,-2],"size":[8,6,4],"inflate":0.25,"uv":{"north":{"uv":[20,42],"uv_size":[8,6]},"east":{"uv":[16,42],"uv_size":[4,6]},"south":{"uv":[32,42],"uv_size":[8,6]},"west":{"uv":[28,42],"uv_size":[4,6]},"up":{"uv":[20,32],"uv_size":[8,4]},"down":{"uv":[28,36],"uv_size":[8,-4]}}},{"origin":[-4,12,-2],"size":[8,6,4],"uv":{"north":{"uv":[20,26],"uv_size":[8,6]},"east":{"uv":[16,26],"uv_size":[4,6]},"south":{"uv":[32,26],"uv_size":[8,6]},"west":{"uv":[28,26],"uv_size":[4,6]},"up":{"uv":[20,16],"uv_size":[8,4]},"down":{"uv":[28,20],"uv_size":[8,-4]}}}]},{"name":"UpperTorso","pivot":[0,18,0],"parent":"LowerTorso","cubes":[{"origin":[-4,18,-2],"size":[8,6,4],"inflate":0.25,"uv":{"north":{"uv":[20,36],"uv_size":[8,6]},"east":{"uv":[16,36],"uv_size":[4,6]},"south":{"uv":[32,36],"uv_size":[8,6]},"west":{"uv":[28,36],"uv_size":[4,6]},"up":{"uv":[20,32],"uv_size":[8,4]},"down":{"uv":[28,36],"uv_size":[8,-4]}}},{"origin":[-4,18,-2],"size":[8,6,4],"uv":{"north":{"uv":[20,20],"uv_size":[8,6]},"east":{"uv":[16,20],"uv_size":[4,6]},"south":{"uv":[32,20],"uv_size":[8,6]},"west":{"uv":[28,20],"uv_size":[4,6]},"up":{"uv":[20,16],"uv_size":[8,4]},"down":{"uv":[28,20],"uv_size":[8,-4]}}}]},{"name":"Head","pivot":[0,24,0],"parent":"UpperTorso","cubes":[{"origin":[-4,24,-4],"size":[8,8,8],"uv":{"north":{"uv":[8,8],"uv_size":[8,8]},"east":{"uv":[0,8],"uv_size":[8,8]},"south":{"uv":[24,8],"uv_size":[8,8]},"west":{"uv":[16,8],"uv_size":[8,8]},"up":{"uv":[8,0],"uv_size":[8,8]},"down":{"uv":[16,8],"uv_size":[8,-8]}}},{"origin":[-4,24,-4],"size":[8,8,8],"inflate":0.25,"uv":{"north":{"uv":[40,8],"uv_size":[8,8]},"east":{"uv":[32,8],"uv_size":[8,8]},"south":{"uv":[56,8],"uv_size":[8,8]},"west":{"uv":[48,8],"uv_size":[8,8]},"up":{"uv":[40,0],"uv_size":[8,8]},"down":{"uv":[48,8],"uv_size":[8,-8]}}}]},{"name":"RightUpperArm","pivot":[6,24,0],"parent":"UpperTorso","cubes":[{"origin":[4,18,-2],"size":[4,6,4],"uv":{"north":{"uv":[44,20],"uv_size":[4,6]},"east":{"uv":[40,20],"uv_size":[4,6]},"south":{"uv":[52,20],"uv_size":[4,6]},"west":{"uv":[48,20],"uv_size":[4,6]},"up":{"uv":[44,16],"uv_size":[4,4]},"down":{"uv":[44,25],"uv_size":[4,1]}}},{"origin":[4,18,-2],"size":[4,6,4],"inflate":0.25,"uv":{"north":{"uv":[44,36],"uv_size":[4,6]},"east":{"uv":[40,36],"uv_size":[4,6]},"south":{"uv":[52,36],"uv_size":[4,6]},"west":{"uv":[48,36],"uv_size":[4,6]},"up":{"uv":[44,32],"uv_size":[4,4]},"down":{"uv":[44,41],"uv_size":[4,1]}}}]},{"name":"RightLowerArm","pivot":[6,18,0],"parent":"RightUpperArm","cubes":[{"origin":[4,14,-2],"size":[4,4,4],"uv":{"north":{"uv":[44,26],"uv_size":[4,4]},"east":{"uv":[40,26],"uv_size":[4,4]},"south":{"uv":[52,26],"uv_size":[4,4]},"west":{"uv":[48,26],"uv_size":[4,4]},"up":{"uv":[44,26],"uv_size":[4,1]},"down":{"uv":[44,29],"uv_size":[4,1]}}},{"origin":[4,14,-2],"size":[4,4,4],"inflate":0.25,"uv":{"north":{"uv":[44,42],"uv_size":[4,4]},"east":{"uv":[40,42],"uv_size":[4,4]},"south":{"uv":[52,42],"uv_size":[4,4]},"west":{"uv":[48,42],"uv_size":[4,4]},"up":{"uv":[44,42],"uv_size":[4,1]},"down":{"uv":[44,45],"uv_size":[4,1]}}}]},{"name":"RightHand","pivot":[6,14,0],"parent":"RightLowerArm","cubes":[{"origin":[4,12,-2],"size":[4,2,4],"uv":{"north":{"uv":[44,30],"uv_size":[4,2]},"east":{"uv":[40,30],"uv_size":[4,2]},"south":{"uv":[52,30],"uv_size":[4,2]},"west":{"uv":[48,30],"uv_size":[4,2]},"up":{"uv":[44,30],"uv_size":[4,1]},"down":{"uv":[48,20],"uv_size":[4,-4]}}},{"origin":[4,12,-2],"size":[4,2,4],"inflate":0.25,"uv":{"north":{"uv":[44,46],"uv_size":[4,2]},"east":{"uv":[40,46],"uv_size":[4,2]},"south":{"uv":[52,46],"uv_size":[4,2]},"west":{"uv":[48,46],"uv_size":[4,2]},"up":{"uv":[44,46],"uv_size":[4,1]},"down":{"uv":[48,36],"uv_size":[4,-4]}}}]},{"name":"RightItem","pivot":[6,12,-2],"parent":"RightHand"},{"name":"LeftUpperArm","pivot":[-6,24,0],"parent":"UpperTorso","cubes":[{"origin":[-8,18,-2],"size":[4,6,4],"uv":{"north":{"uv":[36,52],"uv_size":[4,6]},"east":{"uv":[32,52],"uv_size":[4,6]},"south":{"uv":[44,52],"uv_size":[4,6]},"west":{"uv":[40,52],"uv_size":[4,6]},"up":{"uv":[36,48],"uv_size":[4,4]},"down":{"uv":[36,57],"uv_size":[4,1]}}},{"origin":[-8,18,-2],"size":[4,6,4],"inflate":0.25,"uv":{"north":{"uv":[52,52],"uv_size":[4,6]},"east":{"uv":[48,52],"uv_size":[4,6]},"south":{"uv":[60,52],"uv_size":[4,6]},"west":{"uv":[56,52],"uv_size":[4,6]},"up":{"uv":[52,48],"uv_size":[4,4]},"down":{"uv":[52,57],"uv_size":[4,1]}}}]},{"name":"LeftLowerArm","pivot":[-6,18,0],"parent":"LeftUpperArm","cubes":[{"origin":[-8,14,-2],"size":[4,4,4],"uv":{"north":{"uv":[36,58],"uv_size":[4,4]},"east":{"uv":[32,58],"uv_size":[4,4]},"south":{"uv":[44,58],"uv_size":[4,4]},"west":{"uv":[40,58],"uv_size":[4,4]},"up":{"uv":[36,58],"uv_size":[4,1]},"down":{"uv":[36,61],"uv_size":[4,1]}}},{"origin":[-8,14,-2],"size":[4,4,4],"inflate":0.25,"uv":{"north":{"uv":[52,58],"uv_size":[4,4]},"east":{"uv":[48,58],"uv_size":[4,4]},"south":{"uv":[60,58],"uv_size":[4,4]},"west":{"uv":[56,58],"uv_size":[4,4]},"up":{"uv":[52,58],"uv_size":[4,1]},"down":{"uv":[52,61],"uv_size":[4,1]}}}]},{"name":"LeftHand","pivot":[-6,14,0],"parent":"LeftLowerArm","cubes":[{"origin":[-8,12,-2],"size":[4,2,4],"uv":{"north":{"uv":[36,62],"uv_size":[4,2]},"east":{"uv":[32,62],"uv_size":[4,2]},"south":{"uv":[44,62],"uv_size":[4,2]},"west":{"uv":[40,62],"uv_size":[4,2]},"up":{"uv":[36,62],"uv_size":[4,1]},"down":{"uv":[40,52],"uv_size":[4,-4]}}},{"origin":[-8,12,-2],"size":[4,2,4],"inflate":0.25,"uv":{"north":{"uv":[52,62],"uv_size":[4,2]},"east":{"uv":[48,62],"uv_size":[4,2]},"south":{"uv":[60,62],"uv_size":[4,2]},"west":{"uv":[56,62],"uv_size":[4,2]},"up":{"uv":[52,62],"uv_size":[4,1]},"down":{"uv":[56,52],"uv_size":[4,-4]}}}]},{"name":"LeftItem","pivot":[-6,12,-2],"parent":"LeftHand"},{"name":"RightUpperLeg","pivot":[2,12,0],"parent":"LowerTorso","cubes":[{"origin":[0,6,-2],"size":[4,6,4],"uv":{"north":{"uv":[4,20],"uv_size":[4,6]},"east":{"uv":[0,20],"uv_size":[4,6]},"south":{"uv":[12,20],"uv_size":[4,6]},"west":{"uv":[8,20],"uv_size":[4,6]},"up":{"uv":[4,16],"uv_size":[4,4]},"down":{"uv":[4,25],"uv_size":[4,1]}}},{"origin":[0,6,-2],"size":[4,6,4],"inflate":0.25,"uv":{"north":{"uv":[4,36],"uv_size":[4,6]},"east":{"uv":[0,36],"uv_size":[4,6]},"south":{"uv":[12,36],"uv_size":[4,6]},"west":{"uv":[8,36],"uv_size":[4,6]},"up":{"uv":[4,32],"uv_size":[4,4]},"down":{"uv":[4,41],"uv_size":[4,1]}}}]},{"name":"RightLowerLeg","pivot":[2,6,0],"parent":"RightUpperLeg","cubes":[{"origin":[0,2,-2],"size":[4,4,4],"uv":{"north":{"uv":[4,26],"uv_size":[4,4]},"east":{"uv":[0,26],"uv_size":[4,4]},"south":{"uv":[12,26],"uv_size":[4,4]},"west":{"uv":[8,26],"uv_size":[4,4]},"up":{"uv":[4,26],"uv_size":[4,1]},"down":{"uv":[4,29],"uv_size":[4,1]}}},{"origin":[0,2,-2],"size":[4,4,4],"inflate":0.25,"uv":{"north":{"uv":[4,42],"uv_size":[4,4]},"east":{"uv":[0,42],"uv_size":[4,4]},"south":{"uv":[12,42],"uv_size":[4,4]},"west":{"uv":[8,42],"uv_size":[4,4]},"up":{"uv":[4,42],"uv_size":[4,1]},"down":{"uv":[4,45],"uv_size":[4,1]}}}]},{"name":"RightFoot","pivot":[2,2,0],"parent":"RightLowerLeg","cubes":[{"origin":[0,0,-2],"size":[4,2,4],"uv":{"north":{"uv":[4,30],"uv_size":[4,2]},"east":{"uv":[0,30],"uv_size":[4,2]},"south":{"uv":[12,30],"uv_size":[4,2]},"west":{"uv":[8,30],"uv_size":[4,2]},"up":{"uv":[4,30],"uv_size":[4,1]},"down":{"uv":[8,20],"uv_size":[4,-4]}}},{"origin":[0,0,-2],"size":[4,2,4],"inflate":0.25,"uv":{"north":{"uv":[4,46],"uv_size":[4,2]},"east":{"uv":[0,46],"uv_size":[4,2]},"south":{"uv":[12,46],"uv_size":[4,2]},"west":{"uv":[8,46],"uv_size":[4,2]},"up":{"uv":[4,46],"uv_size":[4,1]},"down":{"uv":[8,36],"uv_size":[4,-4]}}}]},{"name":"LeftUpperLeg","pivot":[-2,12,0],"parent":"LowerTorso","cubes":[{"origin":[-4,6,-2],"size":[4,6,4],"uv":{"north":{"uv":[20,52],"uv_size":[4,6]},"east":{"uv":[16,52],"uv_size":[4,6]},"south":{"uv":[28,52],"uv_size":[4,6]},"west":{"uv":[24,52],"uv_size":[4,6]},"up":{"uv":[20,48],"uv_size":[4,4]},"down":{"uv":[20,57],"uv_size":[4,1]}}},{"origin":[-4,6,-2],"size":[4,6,4],"inflate":0.25,"uv":{"north":{"uv":[4,52],"uv_size":[4,6]},"east":{"uv":[0,52],"uv_size":[4,6]},"south":{"uv":[12,52],"uv_size":[4,6]},"west":{"uv":[8,52],"uv_size":[4,6]},"up":{"uv":[4,48],"uv_size":[4,4]},"down":{"uv":[4,57],"uv_size":[4,1]}}}]},{"name":"LeftLowerLeg","pivot":[-2,6,0],"parent":"LeftUpperLeg","cubes":[{"origin":[-4,2,-2],"size":[4,4,4],"uv":{"north":{"uv":[20,58],"uv_size":[4,4]},"east":{"uv":[16,58],"uv_size":[4,4]},"south":{"uv":[28,58],"uv_size":[4,4]},"west":{"uv":[24,58],"uv_size":[4,4]},"up":{"uv":[20,58],"uv_size":[4,1]},"down":{"uv":[20,61],"uv_size":[4,1]}}},{"origin":[-4,2,-2],"size":[4,4,4],"inflate":0.25,"uv":{"north":{"uv":[4,58],"uv_size":[4,4]},"east":{"uv":[0,58],"uv_size":[4,4]},"south":{"uv":[12,58],"uv_size":[4,4]},"west":{"uv":[8,58],"uv_size":[4,4]},"up":{"uv":[4,58],"uv_size":[4,1]},"down":{"uv":[4,61],"uv_size":[4,1]}}}]},{"name":"LeftFoot","pivot":[-2,2,0],"parent":"LeftLowerLeg","cubes":[{"origin":[-4,0,-2],"size":[4,2,4],"uv":{"north":{"uv":[20,62],"uv_size":[4,2]},"east":{"uv":[16,62],"uv_size":[4,2]},"south":{"uv":[28,62],"uv_size":[4,2]},"west":{"uv":[24,62],"uv_size":[4,2]},"up":{"uv":[20,62],"uv_size":[4,1]},"down":{"uv":[24,52],"uv_size":[4,-4]}}},{"origin":[-4,0,-2],"size":[4,2,4],"inflate":0.25,"uv":{"north":{"uv":[4,62],"uv_size":[4,2]},"east":{"uv":[0,62],"uv_size":[4,2]},"south":{"uv":[12,62],"uv_size":[4,2]},"west":{"uv":[8,62],"uv_size":[4,2]},"up":{"uv":[4,62],"uv_size":[4,1]},"down":{"uv":[8,52],"uv_size":[4,-4]}}}]}]}]}

function sortBonesByParent(bones) {
	const byName = {}; bones.forEach(function (b) { byName[b.name] = b })
	const out = [], done = {}
	function visit(b) {
		if (done[b.name]) return
		if (b.parent && byName[b.parent] && !done[b.parent]) visit(byName[b.parent])
		done[b.name] = true; out.push(b)
	}
	bones.forEach(visit)
	return out
}

function geoIdentifierName(geo) {
	try {
		const list = geo && geo['minecraft:geometry']
		const g = (Array.isArray(list) && list.length) ? list[0] : null
		const id = g && g.description && g.description.identifier
		return id ? String(id).replace(/^geometry\./, '') : ''
	} catch (e) { return '' }
}

function geoToBoneDefs(geo) {
	const list = geo && geo['minecraft:geometry']
	const g = (Array.isArray(list) && list.length) ? list[0] : null
	if (!g || !Array.isArray(g.bones)) return []
	const bones = g.bones.map(function (b) {
		const cubes = (b.cubes || []).map(function (c) {
			const uv = {}
			if (c.uv) for (const f in c.uv) {
				const face = c.uv[f] || {}
				uv[f] = [(face.uv || [0, 0]).slice(), (face.uv_size || [0, 0]).slice()]
			}
			return { origin: (c.origin || [0, 0, 0]).slice(), size: (c.size || [0, 0, 0]).slice(), inflate: c.inflate || 0, uv: uv }
		})
		return { name: b.name, pivot: (b.pivot || [0, 0, 0]).slice(), parent: b.parent || null, cubes: cubes }
	})
	return sortBonesByParent(bones)
}

function buildR15BonesDef() {
	return geoToBoneDefs(R15_GEO)
}

function pickEmoteFormat() {
	if (typeof Formats !== 'undefined') {
		if (Formats.bedrock) return Formats.bedrock
	}
	return (typeof Format !== 'undefined') ? Format : null
}

function buildEmoteModelBones(rigType) {
	const rig = (rigType === 'r15') ? 'r15' : 'r6'
	if (typeof Group === 'undefined' || typeof Cube === 'undefined') return
	const bonesDef = (rig === 'r15') ? buildR15BonesDef() : EMOTE_MODEL_BONES
	const geoName = (rig === 'r15') ? (geoIdentifierName(R15_GEO) || 'player_r15') : 'player_r6'
	try {
		Project.texture_width = EMOTE_MODEL_TEX[0]
		Project.texture_height = EMOTE_MODEL_TEX[1]
		if ('box_uv' in Project) Project.box_uv = false
		if (geoName) { try { Project.geometry_name = geoName } catch (e) {} }
	} catch (e) {}

	Undo.initEdit({ outliner: true, elements: [], selection: true })
	const created = []
	const groups = {}
	bonesDef.forEach(function (bd) {
		const group = new Group({ name: bd.name, origin: bd.pivot.slice() }).init()
		if (bd.parent && groups[bd.parent]) group.addTo(groups[bd.parent])
		try { group.origin = bd.pivot.slice() } catch (e) {}
		groups[bd.name] = group
		bd.cubes.forEach(function (cd) {
			const from = cd.origin.slice()
			const to = [cd.origin[0] + cd.size[0], cd.origin[1] + cd.size[1], cd.origin[2] + cd.size[2]]
			const cube = new Cube({ name: bd.name, from: from, to: to, autouv: 0, inflate: cd.inflate || 0 }).init()
			cube.addTo(group)
			for (const face in cd.uv) {
				if (!cube.faces[face]) continue
				const u = cd.uv[face][0], s = cd.uv[face][1]
				cube.faces[face].uv = [u[0], u[1], u[0] + s[0], u[1] + s[1]]
			}
			created.push(cube)
		})
	})
	try { if (typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll() } catch (e) {}
	Undo.finishEdit('Create Emote Model', { outliner: true, elements: created, selection: true })
	ueNotify((rig === 'r15' ? 'R15' : 'R6') + ' Emote Model created')
}

function createEmoteModelProject(rigType) {
	const rig = (rigType === 'r15') ? 'r15' : 'r6'
	const fmt = pickEmoteFormat()
	if (!fmt || typeof newProject !== 'function') {
		ueNotify('Cannot create project: ' + UE_MSG.UNSUPPORTED, 3000)
		return
	}
	function create(previewModel) {
		if (newProject(fmt)) {
			try { buildEmoteModelBones(rig) } catch (e) { ueFail('Could not build the emote model', e) }
			try {
				const store = getStore()
				if (store && store.pack) store.pack.rig_type = rig
				if (store) store.preview_model = (previewModel === 'thin') ? 'thin' : 'wide'
			} catch (e) {}
		}
	}
	try {
		new Dialog({
			id: 'universal_emotes_new_project',
			title: 'New ' + (rig === 'r15' ? 'R15' : 'R6') + ' Emote Model',
			width: 360,
			form: {
				preview_model: { label: 'Preview Model', type: 'select', value: 'wide', options: { wide: 'Wide', thin: 'Thin' } }
			},
			onConfirm: function (r) {
				const res = r || this.getFormResult()
				this.hide()
				create(res && res.preview_model)
			}
		}).show()
	} catch (e) {
		ueLog.warn('preview model dialog failed, using Wide:', e)
		create('wide')
	}
}
function previewModelMenuChildren() {
	const cur = uePreviewModel()
	return [
		{ name: 'Wide', icon: cur === 'wide' ? 'radio_button_checked' : 'radio_button_unchecked', click: function () { ueSetPreviewModel('wide') } },
		{ name: 'Thin', icon: cur === 'thin' ? 'radio_button_checked' : 'radio_button_unchecked', click: function () { ueSetPreviewModel('thin') } }
	]
}

let new_model_menu_ref = null
let new_model_wrapped_menu = null
let emote_new_separator = null

function getEmoteSeparator() {
	if (emote_new_separator) return emote_new_separator
	if (typeof MenuSeparator !== 'undefined') {
		try {
			emote_new_separator = new MenuSeparator('universal_emotes', 'Universal Emotes')
			try { emote_new_separator.id = 'universal_emotes'; emote_new_separator.label = 'Universal Emotes' } catch (e) {}
		} catch (e) { emote_new_separator = null }
	}
	return emote_new_separator
}

function isOurNewEntry(item) {
	if (item === 'universal_emote_model_new' || item === 'universal_emote_model_new_r6' || item === 'universal_emote_model_new_r15') return true
	if (item && emote_new_separator && item === emote_new_separator) return true
	if (item && typeof item === 'object' && (item.id === 'universal_emotes' || item.id === 'universal_emotes_new_header')) return true
	return false
}

function newMenuItems() {
	const sep = getEmoteSeparator()
	return [sep || '_', 'universal_emote_model_new_r6', 'universal_emote_model_new_r15']
}

function findNewSubmenu(fileMenu) {
	if (!fileMenu || !Array.isArray(fileMenu.structure)) return null
	const cands = fileMenu.structure.filter(function (item) {
		if (!item || typeof item !== 'object') return false
		return Array.isArray(item.children) || typeof item.children === 'function'
	})
	function score(item) {
		const id = String(item.id || '').toLowerCase()
		const nm = String(item.name || '').toLowerCase()
		if (id === 'new' || id.endsWith('.new')) return 3
		if (nm === 'new' || nm.endsWith('.new') || nm === 'menu.file.new') return 2
		if (nm.indexOf('new') !== -1 || id.indexOf('new') !== -1) return 1
		return 0
	}
	let best = null, bestScore = 0
	cands.forEach(function (item) { const s = score(item); if (s > bestScore) { best = item; bestScore = s } })
	return bestScore > 0 ? best : null
}

function placeNewModelEntry() {
	let fileMenu = null
	try { fileMenu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.file : null } catch (e) {}
	const sub = findNewSubmenu(fileMenu)
	if (sub && Array.isArray(sub.children)) {
		for (let i = sub.children.length - 1; i >= 0; i--) if (isOurNewEntry(sub.children[i])) sub.children.splice(i, 1)
		sub.children.push.apply(sub.children, newMenuItems())
		new_model_menu_ref = sub
	} else if (sub && typeof sub.children === 'function') {
		const original = sub.children
		if (!original.__ue_wrapped) {
			const wrapped = function () {
				let arr = []
				try { arr = original.apply(this, arguments) || [] } catch (e) { arr = [] }
				arr = arr.filter(function (x) { return !isOurNewEntry(x) })
				return arr.concat(newMenuItems())
			}
			wrapped.__ue_wrapped = true
			wrapped.__ue_original = original
			sub.children = wrapped
			new_model_wrapped_menu = sub
		}
	} else {
		try { MenuBar.addAction(new_model_action_r6, 'file'); MenuBar.addAction(new_model_action_r15, 'file') } catch (e) {}
		new_model_menu_ref = 'file_action'
	}
	try { if (typeof MenuBar !== 'undefined' && MenuBar.update) MenuBar.update() } catch (e) {}
}

function removeNewModelEntry() {
	try {
		if (new_model_wrapped_menu && typeof new_model_wrapped_menu.children === 'function' && new_model_wrapped_menu.children.__ue_original) {
			new_model_wrapped_menu.children = new_model_wrapped_menu.children.__ue_original
		}
		if (new_model_menu_ref && new_model_menu_ref !== 'file_action' && Array.isArray(new_model_menu_ref.children)) {
			const ch = new_model_menu_ref.children
			for (let i = ch.length - 1; i >= 0; i--) if (isOurNewEntry(ch[i])) ch.splice(i, 1)
		}
	} catch (e) {}
	try { if (emote_new_separator && emote_new_separator.delete) emote_new_separator.delete() } catch (e) {}
	emote_new_separator = null
	new_model_wrapped_menu = null
	new_model_menu_ref = null
	try { if (typeof MenuBar !== 'undefined' && MenuBar.update) MenuBar.update() } catch (e) {}
}

const gizmoIcon = `<svg id="Capa_1" enable-background="new 0 0 511.997 511.997" height="512" viewBox="0 0 511.997 511.997" width="512" xmlns="http://www.w3.org/2000/svg"><g><path d="m285.173 297.718-29.185 156.161c-4.861 0-9.722-1.319-14.019-3.958-.052-.026-.113-.061-.165-.095l-98.531-61.431c-7.066-4.401-11.363-12.144-11.363-20.468v-113.194c0-4.956 1.371-9.696 3.819-13.793z" fill="#bbec6c"/><path d="m380.066 254.733v113.192c0 8.325-4.297 16.067-11.363 20.468l-112.715 51.574v-124.054l44.205-52.854 76.053-22.119c2.448 4.097 3.82 8.837 3.82 13.793z" fill="#f07281"/><path d="m350.068 257.258-94.08 58.655-120.258-74.973c2.457-4.089 6.007-7.526 10.364-9.852.043-.026.078-.052.122-.07l98.523-51.926c7.04-3.707 15.46-3.707 22.5 0l98.523 51.926c.043.017.078.043.122.07-.124-.07-15.816 26.17-15.816 26.17z" fill="#6c7fd8"/><path d="m255.988 439.968 2.218 2.045-2.218 11.865c-4.86 0-9.72-1.32-14.02-3.96-.05-.02-.11-.06-.16-.09l-.82-.51z" fill="#a2e62e"/><path d="m380.068 254.738v113.19c0 8.32-4.3 16.07-11.36 20.47l-98.54 61.43c-.05.03-.11.07-.16.09-4.3 2.64-9.16 3.96-14.02 3.96v-13.91l82.72-51.57c7.06-4.4 11.36-12.15 11.36-20.47v-110.67l8.394-11.145 17.786-5.175c2.45 4.1 3.82 8.84 3.82 13.8z" fill="#eb5569"/><path d="m376.248 240.938-26.18 16.32s0-9.68-3.82-16.32c-2.38-4.13-6.01-7.52-10.37-9.85-.04-.03-.07-.05-.12-.07l-94.77-49.95 3.75-1.98c7.04-3.7 15.46-3.7 22.5 0l98.52 51.93c.05.02.08.04.12.07 4.36 2.33 7.91 5.76 10.37 9.85z" fill="#4f66d0"/><path d="m511.958 470.261c-.036-.273.021-.227-.17-1.148l-11.019-46.708c-.951-4.031-4.991-6.526-9.021-5.578-4.032.951-6.529 4.99-5.578 9.022l6.839 28.991-88.623-55.25-140.898-87.84v-263.522l21.13 21.131c1.465 1.465 3.384 2.197 5.304 2.197 1.919 0 3.839-.732 5.304-2.197 2.929-2.929 2.929-7.678 0-10.606l-33.934-33.934c-2.527-2.594-7.501-3.195-10.607 0l-33.934 33.934c-2.929 2.929-2.929 7.678 0 10.606 2.93 2.929 7.678 2.929 10.607 0l21.13-21.131v263.522l-229.521 143.091 6.839-28.991c.951-4.032-1.546-8.071-5.578-9.022-4.028-.952-8.07 1.546-9.021 5.578l-11.019 46.707c-.852 3.59 1.22 8.038 5.578 9.022l46.708 11.019c.579.136 1.157.202 1.729.202 3.399 0 6.479-2.327 7.293-5.779.951-4.032-1.546-8.071-5.578-9.022l-29.178-6.883 229.248-142.92 140.463 87.569 88.785 55.351-29.178 6.883c-4.032.951-6.529 4.99-5.578 9.022.814 3.452 3.894 5.78 7.293 5.779.57 0 1.15-.065 1.729-.202l46.708-11.019c3.012-.647 6.174-3.918 5.748-7.874z" fill="#6bd9e7"/></g></svg>`;

const styleElement = document.createElement('style');
styleElement.id = 'ptah-icon-style';
styleElement.innerHTML = `
  .icon-ptah_gizmo_icon {
    background-image: url("data:image/svg+xml;utf8,${encodeURIComponent(gizmoIcon)}");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    width: 1em;
    height: 1em;
    display: inline-block !important;
    color: transparent !important;
  }
  .icon-ptah_gizmo_icon:before {
    content: "" !important;
  }
`;

document.head.appendChild(styleElement);


const ASSET_TYPES = [
	{ id: 'sound',    label: 'Sound',    icon: 'volume_up',  ext: '.ogg',  dir: 'audio',    exts: ['ogg'], readtype: 'buffer', file: true },
	{ id: 'texture',  label: 'Texture',  icon: 'image',      ext: '.png',  dir: 'textures', exts: ['png'], readtype: 'image',  file: true },
	{ id: 'model',    label: 'Model',    icon: 'view_in_ar', ext: '.json', dir: 'models',   exts: ['json'], readtype: 'text',  file: true },
	{ id: 'particle', label: 'Particle', icon: 'grain',      ext: '',      dir: '',         exts: [], readtype: null, file: false }
]
function assetTypeDef(id) { for (const t of ASSET_TYPES) if (t.id === id) return t; return null }

let assets_property_registered = false
function ensureAssetsPersistence() {
	if (assets_property_registered) return
	try {
		if (typeof Property !== 'undefined' && typeof ModelProject !== 'undefined') {
			new Property(ModelProject, 'object', 'universal_emotes', { default: null, exposed: false })
			assets_property_registered = true
		}
	} catch (e) {}
}

function getAssets() {
	const store = getStore()
	if (!store) return []
	if (!Array.isArray(store.assets)) store.assets = []
	return store.assets
}
function assetRef(a) {
	const t = assetTypeDef(a.type)
	let ns
	if (t && t.file) {
		const store = getStore()
		ns = (store && store.pack && store.pack.namespace) ? store.pack.namespace : (a.namespace || 'universal_emotes')
	} else {
		ns = a.namespace || 'minecraft'
	}
	return ns + ':' + (a.name || '')
}
function newUuid() { return (typeof guid === 'function') ? guid() : ('a' + Date.now() + Math.random().toString(36).slice(2)) }
function slugifyBase(s) {
	return String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'asset'
}
function slugifyName(s) {
	return slugifyBase(String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/i, ''))
}
function ueJavaSafeSegment(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_.\-]+/g, '_') }
function ueSanitizeTextureRef(v) {
	let ns = '', path = String(v)
	const ci = path.indexOf(':')
	if (ci !== -1) { ns = path.slice(0, ci); path = path.slice(ci + 1) }
	const segs = path.split('/')
	const last = segs.pop()
	const out = segs.map(ueJavaSafeSegment).filter(function (x) { return x !== '' })
	out.push(slugifyBase(String(last || '').replace(/\.png$/i, '')))
	const nsSafe = ns ? ueJavaSafeSegment(ns) : ''
	return (nsSafe ? nsSafe + ':' : '') + out.join('/')
}
function ueSanitizeModelTextures(text) {
	let data
	try { data = JSON.parse(text) } catch (e) { return { text: text, changes: [] } }
	if (!data || typeof data !== 'object' || !data.textures || typeof data.textures !== 'object' || Array.isArray(data.textures)) return { text: text, changes: [] }
	const changes = []
	for (const k in data.textures) {
		const v = data.textures[k]
		if (typeof v !== 'string' || !v || v.charAt(0) === '#') continue
		const nv = ueSanitizeTextureRef(v)
		if (nv !== v) { data.textures[k] = nv; changes.push([v, nv]) }
	}
	if (!changes.length) return { text: text, changes: changes }
	return { text: JSON.stringify(data, null, 2), changes: changes }
}
function uniqueAssetName(base, type, exceptUuid) {
	const list = getAssets()
	let name = base, i = 2
	function taken(n) { return list.some(function (a) { return a.type === type && a.name === n && a.uuid !== exceptUuid }) }
	while (taken(name)) { name = base + '_' + i; i++ }
	return name
}
function arrayBufferToBase64(buf) {
	try {
		const bytes = new Uint8Array(buf)
		let bin = ''
		const chunk = 0x8000
		for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
		return btoa(bin)
	} catch (e) { return '' }
}
function toBase64(content) {
	if (content instanceof ArrayBuffer) return arrayBufferToBase64(content)
	if (typeof content === 'string') {
		if (content.indexOf('data:') === 0) return content.split(',').pop()
		try { return btoa(content) } catch (e) {}
		try { return arrayBufferToBase64(new TextEncoder().encode(content).buffer) } catch (e) {}
	}
	if (content && content.buffer instanceof ArrayBuffer) return arrayBufferToBase64(content.buffer)
	return ''
}
function markProjectDirty() { try { if (typeof Project !== 'undefined' && Project) Project.saved = false } catch (e) {} }

function importAssetFiles(typeId) {
	const t = assetTypeDef(typeId)
	if (!t || !t.file) return
	const store = ueRequireStore()
	if (!store) return
	try {
		Blockbench.import({
			extensions: t.exts,
			type: t.label + ' file',
			readtype: t.readtype,
			multiple: true
		}, function (files) {
			if (!files) return
			const arr = Array.isArray(files) ? files : [files]
			let added = 0
			const renamed = [], failed = []
			arr.forEach(function (f) {
				try {
					const rawName = (f && (f.name || f.path)) ? String(f.name || f.path).split(/[\\/]/).pop() : (t.id + '_file')
					const name = uniqueAssetName(slugifyName(rawName), t.id)
					const asset = {
						uuid: newUuid(),
						type: t.id,
						namespace: store.pack.namespace || 'universal_emotes',
						name: name,
						filename: rawName,
						ext: t.ext
					}
					if (t.id === 'model') {
						const raw = (typeof f.content === 'string') ? f.content : String(f.content || '')
						const san = ueSanitizeModelTextures(raw)
						asset.text = san.text
						san.changes.forEach(function (c) { renamed.push(c[0] + ' \u2192 ' + c[1]) })
					}
					else asset.b64 = toBase64(f.content)
					getAssets().push(asset)
					added++
				} catch (e) { ueLog.error('import asset failed:', f && (f.name || f.path), e); failed.push(String(f && (f.name || f.path) || '?').split(/[\\/]/).pop()) }
			})
			if (added) { markProjectDirty(); refreshAssetsPanel(); ueNotify(added + ' asset(s) added') }
			const notes = []
			if (renamed.length) notes.push('Texture references were changed to Java-safe names so they match the imported texture assets:\n' + renamed.join('\n'))
			if (failed.length) notes.push('These files could not be imported (see console for details):\n' + failed.join('\n'))
			if (notes.length) {
				try { Blockbench.showMessageBox({ title: 'Asset import', message: notes.join('\n\n') }) } catch (e) {}
			}
		})
	} catch (e) { ueFail('Import failed', e) }
}

function addIdAsset(typeId) {
	const t = assetTypeDef(typeId)
	if (!t) return
	const store = ueRequireStore()
	if (!store) return
	new Dialog({
		id: 'universal_emotes_add_id',
		title: 'Add ' + t.label,
		form: {
			namespace: { label: 'Namespace', type: 'text', value: (t.id === 'particle') ? 'minecraft' : (store.pack.namespace || 'universal_emotes') },
			name: { label: t.label + ' name / id', type: 'text', value: '' }
		},
		onConfirm: function () {
			const r = this.getFormResult()
			if (!String(r.name || '').trim()) { ueNotify('Enter a name'); return false }
			getAssets().push({
				uuid: newUuid(),
				type: t.id,
				namespace: ueJavaSafeSegment(String(r.namespace || '').trim()) || 'minecraft',
				name: uniqueAssetName(slugifyName(r.name), t.id)
			})
			markProjectDirty(); refreshAssetsPanel()
			this.hide()
			ueNotify(t.label + ' added')
		}
	}).show()
}

function renameAsset(uuid) {
	const list = getAssets()
	const a = list.find(function (x) { return x.uuid === uuid })
	if (!a) return
	const t = assetTypeDef(a.type)
	const fileBacked = !!(t && t.file)
	const form = {}
	if (!fileBacked) form.namespace = { label: 'Namespace', type: 'text', value: a.namespace }
	form.name = { label: 'Name', type: 'text', value: a.name }
	new Dialog({
		id: 'universal_emotes_rename_asset',
		title: 'Edit Asset',
		form: form,
		onConfirm: function () {
			const r = this.getFormResult()
			const oldRef = assetRef(a)
			if (!fileBacked && r.namespace) a.namespace = ueJavaSafeSegment(String(r.namespace).trim()) || a.namespace
			a.name = uniqueAssetName(slugifyName(r.name || a.name), a.type, a.uuid)
			if (fileBacked) a.filename = a.name + (a.ext || (t && t.ext) || '')
			const newRef = assetRef(a)
			const updated = (oldRef !== newRef) ? ueReplaceAssetRefs(oldRef, newRef, a.type) : 0
			markProjectDirty(); refreshAssetsPanel(); ueRebuildKfFields()
			this.hide()
			ueNotify('Asset renamed' + (updated ? ' (' + updated + ' reference(s) updated)' : ''))
		}
	}).show()
}
function deleteAsset(uuid) {
	const list = getAssets()
	const i = list.findIndex(function (x) { return x.uuid === uuid })
	if (i === -1) return
	const a = list[i], ref = assetRef(a)
	function doDelete() {
		const j = list.indexOf(a)
		if (j !== -1) list.splice(j, 1)
		markProjectDirty(); refreshAssetsPanel()
		ueNotify('Asset deleted: ' + ref)
	}
	try {
		Blockbench.showMessageBox({
			title: 'Delete Asset',
			message: 'Delete "' + ref + '"? Keyframes that use it will lose their asset.',
			buttons: ['Delete', 'Cancel'], confirm: 0, cancel: 1
		}, function (button) { if (button === 0) doDelete() })
	} catch (e) { doDelete() }
}
function copyAssetRef(a) {
	const ref = assetRef(a)
	function fallback() {
		const ta = document.createElement('textarea'); ta.value = ref; document.body.appendChild(ta); ta.select()
		const ok = document.execCommand('copy'); ta.remove()
		if (!ok) throw new Error('clipboard unavailable')
	}
	try {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(ref).then(function () { ueNotify('Copied: ' + ref) }, function () {
				try { fallback(); ueNotify('Copied: ' + ref) } catch (e) { ueFail('Could not copy ' + ref, e) }
			})
		} else { fallback(); ueNotify('Copied: ' + ref) }
	} catch (e) { ueFail('Could not copy ' + ref, e) }
}
function playAssetPreview(a) {
	try {
		if (a.type !== 'sound' || !a.b64) return null
		const audio = new Audio('data:audio/ogg;base64,' + a.b64)
		const pr = audio.play()
		if (pr && pr.catch) pr.catch(function (e) { ueFail('Could not play ' + assetRef(a), e) })
		return audio
	} catch (e) { ueFail('Could not play ' + assetRef(a), e); return null }
}
function ueReplaceAssetRefs(oldRef, newRef, type) {
	let n = 0
	const oldName = String(oldRef).split(':').pop()
	function same(v) { return v === oldRef || (v && String(v).indexOf(':') === -1 && v === oldName) }
	try {
		(Animation.all || []).forEach(function (anim) {
			const ea = anim.animators && anim.animators.effects
			if (!ea) return
			if (type === 'model' || type === 'texture') (ea.models || []).forEach(function (kf) {
				(kf.data_points || []).forEach(function (dp) {
					const m = ueDpModel(dp); if (!m) return
					let ch = false
					if (type === 'model' && same(m.asset_id)) { m.asset_id = newRef; ch = true }
					if (type === 'texture' && same(m.texture)) { m.texture = newRef; ch = true }
					if (ch) { ueWriteDpModel(dp, m); n++ }
				})
			})
			const effCh = (type === 'particle' || type === 'texture') ? 'particle' : (type === 'sound' ? 'sound' : null)
			if (effCh) (ea[effCh] || []).forEach(function (kf) {
				(kf.data_points || []).forEach(function (dp) { if (same(dp.effect)) { dp.effect = newRef; n++ } })
			})
			if (type === 'texture') (ea.timeline || []).forEach(function (kf) {
				(kf.data_points || []).forEach(function (dp) {
					const src = String(dp.script || '')
					const out = src.split(/\r?\n/).map(function (line) {
						const parts = line.trim().split(/\s+/)
						if (parts[0] !== 'set_skin') return line
						let hit = false
						const np = parts.map(function (p, i) { if (i > 0 && same(p)) { hit = true; return newRef } return p })
						if (hit) n++
						return hit ? np.join(' ') : line
					}).join('\n')
					if (out !== src) dp.script = out
				})
			})
		})
	} catch (e) { ueLog.warn('updating asset references failed:', e) }
	return n
}

let last_focused_field = null
function isEditableField(el) {
	if (!el) return false
	if (el.tagName === 'TEXTAREA') return true
	if (el.tagName === 'INPUT') { const ty = (el.type || 'text').toLowerCase(); return ['text', 'search', '', 'number'].indexOf(ty) !== -1 }
	if (el.isContentEditable) return true
	return false
}
function isOurPanelField(el) { return !!(el && el.closest && el.closest('#universal_emotes_assets_wrap')) }
function isPrismField(el) { return !!(el && ((el.closest && el.closest('.prism-editor-wrapper')) || (el.classList && el.classList.contains('prism-editor__textarea')))) }
function nearbyLabelText(el) {
	let node = el, depth = 0
	while (node && depth < 4) {
		let prev = node.previousElementSibling
		while (prev) {
			if (prev.tagName === 'LABEL') return (prev.textContent || '').trim().toLowerCase()
			const innerLab = prev.querySelector && prev.querySelector('label')
			if (innerLab) return (innerLab.textContent || '').trim().toLowerCase()
			prev = prev.previousElementSibling
		}
		if (node.parentElement && node.parentElement.querySelector) {
			const lab = node.parentElement.querySelector('label')
			if (lab) return (lab.textContent || '').trim().toLowerCase()
		}
		node = node.parentElement
		depth++
	}
	return ''
}
function currentKeyframeChannel() { const kf = ueSelectedKeyframe(); return kf ? kf.channel : null }
function isEffectTextField(el, ch) {
	if (!el || !el.closest) return false
	if (isOurPanelField(el)) return false
	if (!el.closest('#panel_keyframe')) return false
	if (el.tagName === 'INPUT') { const ty = (el.type || 'text').toLowerCase(); if (ty === 'number') return false }
	const labelText = nearbyLabelText(el)
	if (labelText.indexOf('effect') !== -1) return true
	if (!labelText && ch === 'sound') return true
	return false
}
function acFieldEligible(el) {
	if (!isEditableField(el)) return false
	if (isPrismField(el)) return false
	if (el.classList && (el.classList.contains('ue_kf_asset_field') || el.classList.contains('ue_kf_script_field'))) return true
	const ch = currentKeyframeChannel()
	if ((ch === 'particle' || ch === 'sound') && isEffectTextField(el, ch)) return true
	return false
}
function currentLineBeforeCursor(el) {
	const v = el.value || ''
	const pos = (typeof el.selectionStart === 'number') ? el.selectionStart : v.length
	const before = v.slice(0, pos)
	const nl = before.lastIndexOf('\n')
	return before.slice(nl + 1)
}
function acAssetItems(type, q, tk) {
	let list = getAssets().filter(function (a) { return a.type === type })
	list = list.filter(function (a) { const r = assetRef(a).toLowerCase(); return !q || r.indexOf(q) !== -1 || (a.name || '').toLowerCase().indexOf(q) !== -1 })
	if (!list.length) return null
	return list.slice(0, 30).map(function (a) { return { label: assetRef(a) + '   (' + a.type + ')', insert: assetRef(a), tokenStart: tk.start, tokenEnd: tk.end } })
}
function acKeywordItems(words, q, tk) {
	const items = words.filter(function (w) { return !q || w.indexOf(q) === 0 }).map(function (w) { return { label: w, insert: w, tokenStart: tk.start, tokenEnd: tk.end } })
	return items.length ? items : null
}
function acInstructionSuggestions(el, tk, q) {
	const line = currentLineBeforeCursor(el)
	const endsWithSpace = /\s$/.test(line)
	const trimmed = line.trim()
	const parts = trimmed.length ? trimmed.split(/\s+/) : []
	const cmds = ['set_skin', 'reset_skin']
	if (parts.length === 0 || (parts.length === 1 && !endsWithSpace)) return acKeywordItems(cmds, q, tk)
	const cmd = parts[0]
	const idx = endsWithSpace ? parts.length : parts.length - 1
	switch (cmd) {
		case 'set_skin':
			if (idx === 1) return acAssetItems('texture', q, tk)
			return acKeywordItems(['auto', 'thin', 'wide', 'default'], q, tk)
	}
	return null
}
function computeAcItems(el) {
	const tk = currentToken(el)
	const q = tk.token.toLowerCase()
	if (el.classList && el.classList.contains('ue_kf_script_field')) {
		return acInstructionSuggestions(el, tk, q)
	}
	if (el.classList && el.classList.contains('ue_kf_asset_field')) {
		const type = (el.dataset && el.dataset.ueAsset) ? el.dataset.ueAsset : 'model'
		return acAssetItems(type, q, tk)
	}
	const ch = currentKeyframeChannel()
	if ((ch === 'particle' || ch === 'sound') && isEffectTextField(el, ch)) {
		return acAssetItems(ch === 'particle' ? 'particle' : 'sound', q, tk)
	}
	return null
}
function insertRefIntoField(a) {
	const ref = assetRef(a)
	const el = last_focused_field
	if (!el || !document.body.contains(el)) { ueNotify('No field focused - copying instead'); copyAssetRef(a); return }
	try {
		el.focus()
		const start = el.selectionStart, end = el.selectionEnd
		if (typeof start === 'number') {
			const v = el.value
			el.value = v.slice(0, start) + ref + v.slice(end)
			const pos = start + ref.length
			el.selectionStart = el.selectionEnd = pos
		} else {
			el.value = (el.value || '') + ref
		}
		el.dispatchEvent(new Event('input', { bubbles: true }))
		el.dispatchEvent(new Event('change', { bubbles: true }))
	} catch (e) { copyAssetRef(a) }
}

let ac_box = null, ac_field = null, ac_items = [], ac_index = -1
function ensureAcBox() {
	if (ac_box) return ac_box
	ac_box = document.createElement('ul')
	ac_box.id = 'universal_emotes_ac'
	ac_box.className = 'prism-editor__autocomplete'
	ac_box.style.cssText = 'position:fixed;z-index:40000;display:none;max-height:190px;overflow:auto;'
	document.body.appendChild(ac_box)
	return ac_box
}
function currentToken(el) {
	const v = el.value || ''
	const pos = (typeof el.selectionStart === 'number') ? el.selectionStart : v.length
	const before = v.slice(0, pos)
	const m = before.match(/[^\s]*$/)
	return { token: m ? m[0] : '', start: pos - (m ? m[0].length : 0), end: pos }
}
function attachAutocomplete(el) { ac_field = el; updateAutocomplete() }
function updateAutocomplete() {
	const el = ac_field
	if (!el || !document.body.contains(el)) return hideAutocomplete()
	const items = computeAcItems(el)
	if (!items || !items.length) return hideAutocomplete()
	ac_items = items.slice(0, 40)
	const box = ensureAcBox()
	box.innerHTML = ''
	ac_index = -1
	ac_items.forEach(function (it, i) {
		const li = document.createElement('li')
		li.textContent = it.label
		li.style.cssText = 'padding:3px 8px;cursor:pointer;white-space:nowrap;border-radius:3px'
		li.addEventListener('mousedown', function (ev) { ev.preventDefault(); applyAcItem(i) })
		li.addEventListener('mouseenter', function () { setAcIndex(i) })
		box.appendChild(li)
	})
	const rect = el.getBoundingClientRect()
	box.style.left = rect.left + 'px'
	box.style.top = (rect.bottom + 2) + 'px'
	box.style.minWidth = Math.max(160, rect.width) + 'px'
	box.style.display = 'block'
}
function setAcIndex(i) {
	ac_index = i
	if (!ac_box) return
	Array.prototype.forEach.call(ac_box.children, function (li, idx) { li.style.background = idx === i ? 'var(--color-accent,#3e90f0)' : 'transparent' })
}
function applyAcItem(i) {
	const el = ac_field, it = ac_items[i]
	if (!el || !it) return hideAutocomplete()
	const v = el.value || ''
	const start = (it.tokenStart != null) ? it.tokenStart : 0
	const end = (it.tokenEnd != null) ? it.tokenEnd : v.length
	el.value = v.slice(0, start) + it.insert + v.slice(end)
	const pos = start + it.insert.length
	try { el.selectionStart = el.selectionEnd = pos } catch (e) {}
	el.dispatchEvent(new Event('input', { bubbles: true }))
	el.dispatchEvent(new Event('change', { bubbles: true }))
	hideAutocomplete()
	el.focus()
}
function hideAutocomplete() { if (ac_box) ac_box.style.display = 'none'; ac_items = []; ac_index = -1 }
function onGlobalFocusIn(e) {
	const el = e.target
	if (isEditableField(el) && !isOurPanelField(el) && !isPrismField(el)) last_focused_field = el
	if (acFieldEligible(el)) attachAutocomplete(el)
	else hideAutocomplete()
}
function onGlobalInput(e) { if (ac_field && e.target === ac_field) updateAutocomplete() }
function onGlobalKeyDown(e) {
	if (!ac_box || ac_box.style.display === 'none' || e.target !== ac_field) return
	if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(Math.min(ac_items.length - 1, ac_index + 1)) }
	else if (e.key === 'ArrowUp') { e.preventDefault(); setAcIndex(Math.max(0, ac_index - 1)) }
	else if (e.key === 'Enter' || e.key === 'Tab') { if (ac_index >= 0) { e.preventDefault(); applyAcItem(ac_index) } }
	else if (e.key === 'Escape') { hideAutocomplete() }
}
function onGlobalFocusOut(e) { if (e.target === ac_field) setTimeout(hideAutocomplete, 150) }
function installAutocomplete() {
	document.addEventListener('focusin', onGlobalFocusIn, true)
	document.addEventListener('input', onGlobalInput, true)
	document.addEventListener('keydown', onGlobalKeyDown, true)
	document.addEventListener('focusout', onGlobalFocusOut, true)
	window.addEventListener('scroll', hideAutocomplete, true)
}
function uninstallAutocomplete() {
	document.removeEventListener('focusin', onGlobalFocusIn, true)
	document.removeEventListener('input', onGlobalInput, true)
	document.removeEventListener('keydown', onGlobalKeyDown, true)
	document.removeEventListener('focusout', onGlobalFocusOut, true)
	window.removeEventListener('scroll', hideAutocomplete, true)
	hideAutocomplete()
	if (ac_box && ac_box.parentNode) ac_box.parentNode.removeChild(ac_box)
	ac_box = null; ac_field = null; last_focused_field = null
}

let asset_styles_el = null
function injectAssetStyles() {
	if (asset_styles_el) return
	asset_styles_el = document.createElement('style')
	asset_styles_el.textContent = [
		'#universal_emotes_assets_wrap .ue_btn{display:flex;align-items:center;gap:3px;padding:3px 6px;font-size:11px;background:var(--color-button,#3a3a3a);border:none;border-radius:4px;cursor:pointer;color:var(--color-text,#ddd);}',
		'#universal_emotes_assets_wrap .ue_btn:hover{background:var(--color-accent,#3e90f0);}',
		'#universal_emotes_assets_wrap .ue_btn i{font-size:15px;}',
		'#universal_emotes_assets_wrap .ue_asset_row{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;}',
		'#universal_emotes_assets_wrap .ue_asset_row:hover{background:var(--color-selected,rgba(255,255,255,.07));}',
		'#universal_emotes_assets_wrap .ue_ref{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
		'#universal_emotes_assets_wrap .ue_actions{display:flex;gap:2px;opacity:.55;}',
		'#universal_emotes_assets_wrap .ue_asset_row:hover .ue_actions{opacity:1;}',
		'#universal_emotes_assets_wrap .ue_ic{font-size:16px;cursor:pointer;}',
		'#universal_emotes_assets_wrap .ue_ic:hover{color:var(--color-accent,#3e90f0);}'
	].join('\n')
	document.head.appendChild(asset_styles_el)
}

let assets_panel = null
function refreshAssetsPanel() { try { if (assets_panel && assets_panel.vue && assets_panel.vue.pull) assets_panel.vue.pull() } catch (e) {} }
function createAssetsPanel() {
	if (typeof Panel === 'undefined') return
	injectAssetStyles()
	try {
		assets_panel = new Panel('universal_emotes_assets', {
			name: 'Emote Assets',
			id: 'universal_emotes_assets',
			icon: 'inventory_2',
			condition: { modes: ['animate'], method: function () { return typeof Project !== 'undefined' && !!Project } },
			toolbars: [],
			growable: true,
			default_position: { slot: 'right_bar', float_position: [0, 0], float_size: [320, 400], height: 360, folded: false },
			component: {
				name: 'universal-emotes-assets-panel',
				data() { return { assets: [], q: '', typeDefs: ASSET_TYPES, playingUuid: null } },
				computed: {
					filtered() {
						const q = (this.q || '').toLowerCase()
						return this.assets.filter(function (a) { return !q || (a.namespace + ':' + a.name).toLowerCase().indexOf(q) !== -1 })
					}
				},
				methods: {
					pull() { this.assets = getAssets(); if (this.$forceUpdate) this.$forceUpdate() },
					isFile(id) { const t = assetTypeDef(id); return !!(t && t.file) },
					iconFor(id) { const t = assetTypeDef(id); return t ? t.icon : 'help' },
					clickType(id) { if (this.isFile(id)) importAssetFiles(id); else addIdAsset(id) },
					ref(a) { return assetRef(a) },
					insert(a) { insertRefIntoField(a) },
					copy(a) { copyAssetRef(a) },
					play(a) {
						if (this.playingUuid === a.uuid && this._ueAudio) {
							try { this._ueAudio.pause() } catch (e) {}
							this._ueAudio = null; this.playingUuid = null; return
						}
						if (this._ueAudio) { try { this._ueAudio.pause() } catch (e) {} this._ueAudio = null }
						const audio = playAssetPreview(a)
						if (!audio) { this.playingUuid = null; return }
						this._ueAudio = audio; this.playingUuid = a.uuid
						const self = this
						audio.addEventListener('ended', function () { if (self.playingUuid === a.uuid) { self.playingUuid = null; self._ueAudio = null; if (self.$forceUpdate) self.$forceUpdate() } })
						if (this.$forceUpdate) this.$forceUpdate()
					},
					edit(a) { renameAsset(a.uuid) },
					remove(a) { deleteAsset(a.uuid) }
				},
				mounted() { this.pull() },
				template: `
					<div id="universal_emotes_assets_wrap" style="padding:6px 8px;display:flex;flex-direction:column;gap:6px;height:100%;box-sizing:border-box;">
						<div style="display:flex;flex-wrap:wrap;gap:4px;">
							<button v-for="t in typeDefs" :key="t.id" class="ue_btn" @click="clickType(t.id)" :title="(isFile(t.id)?'Import ':'Add ')+t.label">
								<i class="material-icons">{{ t.icon }}</i><span>{{ t.label }}</span>
							</button>
						</div>
						<input type="text" v-model="q" placeholder="Search assets…" class="dark_bordered" style="width:100%;box-sizing:border-box;" />
						<ul style="list-style:none;margin:0;padding:0;overflow:auto;flex:1;">
							<li v-if="!filtered.length" style="opacity:.6;padding:8px;text-align:center;line-height:1.4;">No assets yet.<br>Import a sound / texture / model,<br>or add a particle id.</li>
							<li v-for="a in filtered" :key="a.uuid" class="ue_asset_row">
								<i class="material-icons" style="font-size:16px;opacity:.8;">{{ iconFor(a.type) }}</i>
								<span class="ue_ref" :title="ref(a)">{{ ref(a) }}</span>
								<span class="ue_actions">
									<i v-if="a.type==='sound'" class="material-icons ue_ic" :title="playingUuid===a.uuid?'Pause':'Play'" @click="play(a)">{{ playingUuid===a.uuid ? 'pause' : 'play_arrow' }}</i>
									<i class="material-icons ue_ic" title="Insert into focused field" @click="insert(a)">input</i>
									<i class="material-icons ue_ic" title="Copy reference" @click="copy(a)">content_copy</i>
									<i class="material-icons ue_ic" title="Edit" @click="edit(a)">edit</i>
									<i class="material-icons ue_ic" title="Delete" @click="remove(a)">delete</i>
								</span>
							</li>
						</ul>
					</div>
				`
			}
		})
		try { if (Blockbench.on) Blockbench.on('select_project', refreshAssetsPanel) } catch (e) {}
	} catch (e) { ueLog.error('Emote Assets panel could not be created:', e) }
}
function removeAssetsPanel() {
	try { if (Blockbench.removeListener) Blockbench.removeListener('select_project', refreshAssetsPanel) } catch (e) {}
	try { if (assets_panel && assets_panel.delete) assets_panel.delete() } catch (e) {}
	assets_panel = null
}

function writeEmbeddedAssets(assetsFolder, store) {
	const written = new Set()
	try {
		const list = (store && Array.isArray(store.assets)) ? store.assets : []
		list.forEach(function (a) {
			const t = assetTypeDef(a.type)
			written.add(assetRef(a))
			if (!t || !t.file || !t.dir) return
			const fname = (a.name || 'asset') + (a.ext || t.ext || '')
			try {
				if (a.type === 'model' && a.text != null) assetsFolder.folder(t.dir).file(fname, ueSanitizeModelTextures(a.text).text)
				else if (a.b64) assetsFolder.folder(t.dir).file(fname, a.b64, { base64: true })
			} catch (e) {}
		})
	} catch (e) {}
	return written
}


BBPlugin.register('universal-emotes-plugin', {
	title: 'Universal Emotes Helper',
	icon: 'icon-ptah_gizmo_icon',
	author: 'ptah',
	description: 'Blockbench helper for the Universal Emote mod, with support for viewing and editing bends, and exporting Bundle packages.',
	version: UE_VERSION,
	variant: 'both',
	onload() {
		ueLog.info('loaded v' + UE_VERSION)
		ueNotify('Universal Emotes v' + UE_VERSION + ' loaded', 2500)
		addBendChannel()
		try { addModelsEffectChannel() } catch (e) {}
		try { ueRegisterDataPointProps() } catch (e) {}
		try { ueInstallCreateKeyframeHook() } catch (e) {}
		try { installPreviewHooks() } catch (e) {}
		try { ueWrapCodecs() } catch (e) {}
		try { ueRegisterLoopStartProperty() } catch (e) {}
		try { ueInstallLoopPlayback() } catch (e) {}
		try { ueInstallLoopImport() } catch (e) {}
		try { ueInstallLoopBar() } catch (e) {}

		if (typeof Blockbench !== 'undefined' && Blockbench.on) {
			Blockbench.on('select_mode', onBendContextChange)
			Blockbench.on('unselect_mode', onBendContextChange)
			Blockbench.on('select_animation', onBendContextChange)
			Blockbench.on('unselect_animation', onBendContextChange)
			Blockbench.on('unselect_project', ueOnUnselectProject)
			Blockbench.on('select_project', ueOnSelectProject)
		}
		startBendWatchdog()

		settings_action = new Action('universal_emotes_settings_action', {
			name: 'Bundle Settings',
			icon: 'settings_suggest',
			description: 'Bundle settings (pack.json). Per-emote info is in the animation right-click menu.',
			condition: function () { return typeof Project !== 'undefined' && !!Project },
			click: function () { openSettingsDialog() }
		})
		export_action = new Action('export_bundle_action', {
			name: 'Export Emote Bundle',
			icon: 'inventory_2',
			description: 'Export all emotes as a single .zip bundle',
			condition: function () { return typeof Project !== 'undefined' && !!Project },
			click: function () {
				try { Promise.resolve(exportBundle()).catch(function (e) { ueFail('Export failed', e) }) } catch (e) { ueFail('Export failed', e) }
			}
		})

		toggle_preview_action = new Action('toggle_bend_preview', {
			name: 'Toggle Bend Preview',
			icon: 'visibility',
			condition: function () { return !isR15() },
			description: 'Toggle bend preview on/off (data and export are NOT affected)',
			click: function () {
				bend_preview_enabled = !bend_preview_enabled
				if (!bend_preview_enabled && typeof Group !== 'undefined') {
					Group.all.forEach(function (g) { try { restoreGroupGeometry(g) } catch (e) {} })
				}
				ueNotify('Bend preview: ' + (bend_preview_enabled ? 'ON' : 'OFF'))
				if (typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll()
			}
		})

		toggle_mode_action = new Action('toggle_bend_mode', {
			name: 'Toggle Bend Mode (Smooth/Exact)',
			icon: 'timeline',
			condition: function () { return !isR15() },
			description: 'It makes the bend smoother.',
			click: function () {
				bend_smooth_mode = !bend_smooth_mode
				if (typeof Group !== 'undefined') Group.all.forEach(function (g) { try { restoreGroupGeometry(g) } catch (e) {} })
				try { ueApplyArmModel(null) } catch (e) {}
				original_geometry_cache = new WeakMap()
				ueNotify('Bend mode: ' + (bend_smooth_mode ? 'Smooth arc' : 'Exact hinge'))
				if (typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll()
			}
		})

		anim_emote_action = new Action('anim_emote_settings', {
			name: 'Emote Settings\u2026',
			icon: 'badge',
			description: 'Per-emote settings (id, name, description, OP level, rarity)',
			click: function (context) {
				let anim = null
				try { if (typeof Animation !== 'undefined' && context instanceof Animation) anim = context } catch (e) {}
				if (!anim) anim = (typeof Animation !== 'undefined') ? Animation.selected : null
				openEmoteDialogFor(anim)
			}
		})
		new_model_action_r6 = new Action('universal_emote_model_new_r6', {
			name: 'R6 Emote Model',
			icon: 'icon-ptah_gizmo_icon',
			description: 'Create a new R6 project (classic player rig, Bend enabled)',
			click: function () { createEmoteModelProject('r6') }
		})
		new_model_action_r15 = new Action('universal_emote_model_new_r15', {
			name: 'R15 Emote Model',
			icon: 'icon-ptah_gizmo_icon',
			description: 'Create a new R15 project (15-part rig, Bend disabled)',
			click: function () { createEmoteModelProject('r15') }
		})
		edit_model_kf_action = new Action('ue_edit_model_keyframe', {
			name: 'Edit Model Event\u2026',
			icon: 'view_in_ar',
			description: 'Edit the selected Models keyframe (asset, attach mode, bone, position, rotation, scale)',
			condition: function () { return !!selectedModelsKeyframe() },
			click: function () { openModelKeyframeDialog() }
		})
		try {
			if (typeof Animation !== 'undefined' && Animation.prototype && Animation.prototype.menu && Array.isArray(Animation.prototype.menu.structure)) {
				const amenu = Animation.prototype.menu.structure
				if (amenu.indexOf('anim_emote_settings') === -1) {
					amenu.push('_')
					amenu.push('anim_emote_settings')
				}
			}
		} catch (e) {}

		preview_model_action = new Action('ue_preview_model', {
			name: 'Preview Model',
			icon: 'accessibility_new',
			description: 'Character arm model shown in the animation preview (Wide / Thin). Editor only, not exported.',
			condition: function () { return typeof Project !== 'undefined' && !!Project },
			children: previewModelMenuChildren,
			click: function () {}
		})

		if (MenuBar.menus.animation) {
			MenuBar.addAction(toggle_preview_action, 'animation')
			MenuBar.addAction(toggle_mode_action, 'animation')
		}

		placeFileMenuActions()
		placeAnimationMenuActions()
		placeNewModelEntry()
		try { ensureAssetsPersistence() } catch (e) {}
		try { createAssetsPanel() } catch (e) {}
		try { installAutocomplete() } catch (e) {}
		try { installKfPanel() } catch (e) {}
		try { ueInstallGizmo() } catch (e) { ueLog.warn('object gizmo install failed:', e) }
	},
	onunload() {
		stopBendWatchdog()
		try { ueUninstallGizmo() } catch (e) {}
		try { ueUninstallCreateKeyframeHook() } catch (e) {}
		try { ueUnwrapCodecs() } catch (e) {}
		try { uninstallPreviewHooks() } catch (e) {}
		try { ueUninstallLoopBar() } catch (e) {}
		try { ueUninstallLoopPlayback() } catch (e) {}
		try { ueUninstallLoopImport() } catch (e) {}
		try { ueUnregisterLoopStartProperty() } catch (e) {}
		try { removeModelsEffectChannel() } catch (e) {}
		try { ueApplyArmModel('wide') } catch (e) {}
		try { restoreAllBendGeometry() } catch (e) {}
		try {
			if (typeof Animation !== 'undefined' && Animation.prototype && Animation.prototype.menu && Array.isArray(Animation.prototype.menu.structure)) {
				const amenu = Animation.prototype.menu.structure
				const ai = amenu.indexOf('anim_emote_settings')
				if (ai !== -1) amenu.splice(ai, 1)
			}
		} catch (e) {}
		try { removeNewModelEntry() } catch (e) {}
		try { removeFileMenuActions() } catch (e) {}
		try { removeAnimationMenuActions() } catch (e) {}
		try { uninstallAutocomplete() } catch (e) {}
		try { uninstallKfPanel() } catch (e) {}
		try { stopAllUeAudio() } catch (e) {}
		try { clearParticleMarkers() } catch (e) {}
		try { removeAssetsPanel() } catch (e) {}
		try { if (asset_styles_el && asset_styles_el.parentNode) asset_styles_el.parentNode.removeChild(asset_styles_el); asset_styles_el = null } catch (e) {}
		const acts = [settings_action, export_action, toggle_preview_action, toggle_mode_action, anim_emote_action, new_model_action_r6, new_model_action_r15, edit_model_kf_action, preview_model_action]
		acts.forEach(function (a) { if (a) a.delete() })
		try {
			if (typeof Blockbench !== 'undefined' && Blockbench.removeListener) {
				Blockbench.removeListener('select_mode', onBendContextChange)
				Blockbench.removeListener('unselect_mode', onBendContextChange)
				Blockbench.removeListener('select_animation', onBendContextChange)
				Blockbench.removeListener('unselect_animation', onBendContextChange)
				Blockbench.removeListener('unselect_project', ueOnUnselectProject)
				Blockbench.removeListener('select_project', ueOnSelectProject)
			}
		} catch (e) {}
		try { restoreAllBendGeometry() } catch (e) {}
		try { ueUnregisterDataPointProps() } catch (e) {}
	}
})

})();
