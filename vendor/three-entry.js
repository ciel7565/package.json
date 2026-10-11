// Vendor bundle entry: three.js core + the addons the game uses.
// esbuild bundles this into a single IIFE that is inlined into index.html,
// so the game runs offline from a single file (file:// double-click).
import * as THREE_NS from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

window.THREE = THREE_NS;
window.THREE_ADDONS = {
  Sky, Lensflare, LensflareElement, BufferGeometryUtils, SimplexNoise,
  EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass,
  RoundedBoxGeometry, GLTFLoader,
};
