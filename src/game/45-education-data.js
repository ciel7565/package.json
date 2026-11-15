// =============================================================================
// 45-education-data.js — education contents, quizzes, exhibit cards, hall guide.
//
// PURE DATA: no THREE / DOM access. tools/build.mjs also evaluates this file in Node
// to export quiz rewards for the PHP server (server/data/game-data.json).
//
// Facts are short, general, widely accepted summaries written for teens/adults.
// They are NOT expert-reviewed: every content carries `source` + `verified:false`
// (spec #72: Source / Author / ReferenceDate / EducationalCategory).
//
// Page visual types (rendered by 46-education.js):
//   { type:'model', model:'jar'|'meju'|'bean'|'pepper'|'cabbage'|'kimchi'|'jige'|'maetdol'|'tools'|'soy'|
//                   'doenjang'|'gochujang'|'vinegar'|'season', opts?:{lidOpen:true}, caption? }
//   { type:'emoji', emoji:'🏺', caption? }
//   { type:'svg', svg:'<svg ...>', caption? }
//   { type:'steps', items:[{icon, label, sep?}], sep:'→', caption? }   (flow / icon row)
// =============================================================================

(function () {
  const SRC = '일반 상식 요약(교육용) — 전문 감수 필요';
  const AUTHOR = '전통발효체험관 교육 콘텐츠(체험관용 요약)';
  const REF_DATE = '2026-10';

  G.data.educationCategories = {
    ferment: { name: '발효 기초', color: '#e0a35a', icon: '🧫' },
    onggi: { name: '옹기·장독대', color: '#b5774a', icon: '🏺' },
    jang: { name: '장 담그기', color: '#c9925a', icon: '🫘' },
    kimchi: { name: '김치', color: '#e2574c', icon: '🥬' },
    farming: { name: '전통농업', color: '#7fbf5a', icon: '🌾' },
    tools: { name: '전통도구', color: '#6fb6e8', icon: '🛠️' },
  };

  // ---------------------------------------------------------------- inline illustrations (viewBox 320x240)
  const FONT = "font-family=\"PretendardEmbed,Pretendard,'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif\"";
  const SVG = {
    microbes: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><radialGradient id="emg" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#efdcb8"/></radialGradient></defs>
<path d="M196 166 L250 220" stroke="#5a3a22" stroke-width="20" stroke-linecap="round"/>
<path d="M196 166 L250 220" stroke="#8a5a3b" stroke-width="12" stroke-linecap="round"/>
<circle cx="138" cy="108" r="88" fill="url(#emg)" stroke="#6b4a2b" stroke-width="11"/>
<circle cx="138" cy="108" r="80" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-dasharray="60 400" transform="rotate(200 138 108)"/>
<g fill="#86cf7c" stroke="#3f8a3a" stroke-width="2.5">
<rect x="78" y="62" width="46" height="17" rx="8.5" transform="rotate(-22 101 70)"/>
<rect x="150" y="138" width="42" height="16" rx="8" transform="rotate(24 171 146)"/>
<rect x="96" y="146" width="36" height="15" rx="7.5" transform="rotate(-6 114 153)"/>
</g>
<g fill="#2b2118"><circle cx="96" cy="69" r="2"/><circle cx="106" cy="66" r="2"/><circle cx="165" cy="143" r="2"/><circle cx="175" cy="147" r="2"/><circle cx="109" cy="151" r="1.8"/><circle cx="118" cy="151" r="1.8"/></g>
<g fill="#f6c453" stroke="#b9860f" stroke-width="2.5"><circle cx="176" cy="80" r="18"/><circle cx="196" cy="64" r="9"/><circle cx="92" cy="114" r="13"/></g>
<g fill="#2b2118"><circle cx="170" cy="78" r="2.2"/><circle cx="181" cy="78" r="2.2"/><circle cx="88" cy="112" r="1.8"/><circle cx="96" cy="112" r="1.8"/></g>
<path d="M170 86q5.5 4 11 0" fill="none" stroke="#2b2118" stroke-width="1.8" stroke-linecap="round"/>
<g fill="none" stroke="#9b86d6" stroke-width="3.2" stroke-linecap="round"><path d="M122 116c10-15 22-13 30-3s20 10 27 0"/><path d="M140 108c-3-12 5-19 12-23"/><path d="M152 113c3 10 0 18-6 24"/></g>
<g fill="#b5a2ee" stroke="#7d68c2" stroke-width="2"><circle cx="153" cy="84" r="6"/><circle cx="180" cy="113" r="6"/><circle cx="145" cy="138" r="5"/></g>
<g ${FONT} font-size="16.5" font-weight="800">
<rect x="234" y="32" width="76" height="30" rx="15" fill="#f6c453"/><text x="272" y="53" text-anchor="middle" fill="#4a3300">효모</text>
<rect x="234" y="70" width="76" height="30" rx="15" fill="#86cf7c"/><text x="272" y="91" text-anchor="middle" fill="#163d14">세균</text>
<rect x="234" y="108" width="76" height="30" rx="15" fill="#b5a2ee"/><text x="272" y="129" text-anchor="middle" fill="#2e1f63">곰팡이</text>
</g>
<text class="ev-cap" x="14" y="228" font-size="12.5" fill="#6b4a2b" font-weight="600">눈에 보이지 않을 만큼 작은 미생물이 발효를 일으켜요</text>
</svg>`,

    fermentVsRot: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<rect x="10" y="22" width="138" height="170" rx="18" fill="#e9f6e2" stroke="#7cc576" stroke-width="3"/>
<rect x="172" y="22" width="138" height="170" rx="18" fill="#f6e6e3" stroke="#e08a80" stroke-width="3"/>
<ellipse cx="79" cy="66" rx="30" ry="7" fill="#3b2416"/>
<path d="M50 70c-14 18-12 62 6 84h46c18-22 20-66 6-84z" fill="#6b4126"/>
<path d="M54 98h50" stroke="#e7c27a" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="68" cy="118" rx="6" ry="16" fill="#fff" opacity=".18"/>
<circle cx="120" cy="56" r="17" fill="#34c36b"/><path d="m112 56 6 6 11-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="79" y="178" text-anchor="middle" font-size="17" font-weight="800" fill="#1f6e3a">발효</text>
<path d="M200 128c0-22 18-36 41-36s41 14 41 36v26h-82z" fill="#e2b46c"/>
<path d="M200 128c0-22 18-36 41-36s41 14 41 36" fill="none" stroke="#b9853b" stroke-width="3"/>
<g fill="#7d8b6a" opacity=".9"><circle cx="222" cy="120" r="9"/><circle cx="252" cy="136" r="12"/><circle cx="270" cy="114" r="7"/><circle cx="236" cy="146" r="6"/></g>
<g fill="#a7b48f"><circle cx="219" cy="117" r="3"/><circle cx="248" cy="132" r="4"/></g>
<circle cx="282" cy="56" r="17" fill="#ff6b5e"/><path d="m275 49 14 14m0-14-14 14" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<text x="241" y="178" text-anchor="middle" font-size="17" font-weight="800" fill="#a23a30">부패</text>
<text class="ev-cap" x="160" y="214" text-anchor="middle" font-size="12.5" font-weight="600" fill="#5a4636">둘 다 미생물의 작용 · 먹기 좋게 변하면 발효, 상하면 부패</text>
</svg>`,

    agingTimeline: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<path d="M26 70 Q160 -6 294 70" fill="none" stroke="#e7c27a" stroke-width="3" stroke-dasharray="6 7"/>
<circle cx="70" cy="44" r="13" fill="#f6c453"/><g stroke="#f6c453" stroke-width="3" stroke-linecap="round"><path d="M70 22v-6M70 72v-4M48 44h-6M98 44h-6"/></g>
<path d="M258 32a15 15 0 1 0 14 22 12 12 0 0 1-14-22z" fill="#c9d4f2"/>
<g transform="translate(0 6)">
<g transform="translate(40 96)"><ellipse cx="22" cy="6" rx="16" ry="4" fill="#3b2416"/><path d="M6 8c-9 12-8 40 4 54h24c12-14 13-42 4-54z" fill="#7a4a2c"/><rect x="9" y="38" width="26" height="22" rx="6" fill="#c9a46a"/></g>
<g transform="translate(110 92)"><ellipse cx="22" cy="6" rx="17" ry="4" fill="#3b2416"/><path d="M5 8c-9 13-8 44 4 58h26c12-14 13-45 4-58z" fill="#6f4227"/><rect x="8" y="34" width="28" height="30" rx="7" fill="#a87a45"/></g>
<g transform="translate(180 88)"><ellipse cx="23" cy="6" rx="18" ry="4.5" fill="#3b2416"/><path d="M5 9c-10 14-9 47 4 62h28c13-15 14-48 4-62z" fill="#653a22"/><rect x="8" y="30" width="30" height="38" rx="8" fill="#7d5530"/></g>
<g transform="translate(250 84)"><ellipse cx="23" cy="6" rx="19" ry="4.5" fill="#3b2416"/><path d="M4 9c-10 15-9 51 5 66h29c14-15 15-51 5-66z" fill="#5a321d"/><rect x="7" y="26" width="32" height="46" rx="9" fill="#4e3218"/></g>
</g>
<path d="M30 196h260" stroke="#b08a5a" stroke-width="3" stroke-linecap="round"/><path d="m282 189 10 7-10 7" fill="none" stroke="#b08a5a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<g font-size="13" font-weight="700" fill="#5a3a22" text-anchor="middle"><text x="62" y="186">며칠</text><text x="132" y="186">몇 주</text><text x="203" y="186">몇 달</text><text x="273" y="186">몇 년</text></g>
<text class="ev-cap" x="160" y="224" text-anchor="middle" font-size="12.5" font-weight="600" fill="#6b4a2b">시간이 흐를수록 색은 짙어지고 맛은 깊어져요</text>
</svg>`,

    jangdokdae: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><linearGradient id="ejs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3ff"/><stop offset="1" stop-color="#fff4dc"/></linearGradient><linearGradient id="ejj" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a4628"/><stop offset=".45" stop-color="#5a321d"/><stop offset="1" stop-color="#3b2214"/></linearGradient></defs>
<rect width="320" height="240" rx="18" fill="url(#ejs)"/>
<circle cx="268" cy="44" r="20" fill="#ffd766"/><circle cx="268" cy="44" r="30" fill="#ffd766" opacity=".25"/>
<path d="M0 120 L60 70 L110 104 L170 58 L240 108 L320 80 V150 H0z" fill="#8fbf7a"/>
<path d="M0 138 L80 104 L150 132 L230 98 L320 126 V160 H0z" fill="#6aa65a"/>
<rect x="18" y="176" width="284" height="40" rx="6" fill="#b9b1a3"/>
<g fill="#a69d8e" stroke="#8d8578" stroke-width="1.5"><rect x="22" y="182" width="44" height="14" rx="4"/><rect x="70" y="182" width="52" height="14" rx="4"/><rect x="126" y="182" width="40" height="14" rx="4"/><rect x="170" y="182" width="56" height="14" rx="4"/><rect x="230" y="182" width="68" height="14" rx="4"/><rect x="22" y="199" width="60" height="13" rx="4"/><rect x="86" y="199" width="44" height="13" rx="4"/><rect x="134" y="199" width="58" height="13" rx="4"/><rect x="196" y="199" width="46" height="13" rx="4"/><rect x="246" y="199" width="52" height="13" rx="4"/></g>
<rect x="40" y="150" width="240" height="28" rx="5" fill="#cbc3b4"/>
<g>
<g transform="translate(50 108)"><path d="M6 12c-10 12-9 34 5 44h26c14-10 15-32 5-44z" fill="url(#ejj)"/><ellipse cx="24" cy="10" rx="18" ry="5" fill="#2e1a10"/><ellipse cx="24" cy="7" rx="14" ry="5" fill="#4a2a18"/></g>
<g transform="translate(104 98)"><path d="M6 14c-12 14-11 40 6 52h30c17-12 18-38 6-52z" fill="url(#ejj)"/><ellipse cx="27" cy="12" rx="21" ry="6" fill="#2e1a10"/><ellipse cx="27" cy="8" rx="16" ry="6" fill="#4a2a18"/></g>
<g transform="translate(164 104)"><path d="M6 13c-11 13-10 37 5 48h28c15-11 16-35 5-48z" fill="url(#ejj)"/><ellipse cx="25" cy="11" rx="19" ry="5.5" fill="#2e1a10"/><ellipse cx="25" cy="8" rx="15" ry="5" fill="#4a2a18"/></g>
<g transform="translate(220 114)"><path d="M5 10c-8 10-7 28 4 37h22c11-9 12-27 4-37z" fill="url(#ejj)"/><ellipse cx="20" cy="9" rx="15" ry="4.5" fill="#2e1a10"/><ellipse cx="20" cy="6" rx="12" ry="4" fill="#4a2a18"/></g>
</g>
<g fill="#fff" opacity=".22"><ellipse cx="62" cy="134" rx="4" ry="11"/><ellipse cx="119" cy="128" rx="5" ry="14"/><ellipse cx="178" cy="131" rx="4" ry="12"/><ellipse cx="231" cy="136" rx="3" ry="9"/></g>
<g stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity=".85" fill="none"><path d="M18 74c14-6 22 6 36 0"/><path d="M30 92c14-6 22 6 36 0"/></g>
<text class="ev-cap" x="160" y="232" text-anchor="middle" font-size="12" font-weight="700" fill="#5a3a22">햇볕 잘 들고 바람 잘 통하는 높은 돌단 위</text>
</svg>`,

    jarTypes: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><linearGradient id="ejt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5432"/><stop offset=".5" stop-color="#5e3520"/><stop offset="1" stop-color="#3d2215"/></linearGradient></defs>
<path d="M14 196h292" stroke="#c7b08a" stroke-width="3" stroke-linecap="round"/>
<g transform="translate(18 38)"><ellipse cx="34" cy="8" rx="22" ry="5" fill="#2e1a10"/><path d="M14 10c-14 22-12 120 4 148h32c16-28 18-126 4-148z" fill="url(#ejt)"/><path d="M12 58h44" stroke="#c9a46a" stroke-width="2" opacity=".7"/><ellipse cx="26" cy="90" rx="5" ry="26" fill="#fff" opacity=".14"/></g>
<g transform="translate(96 84)"><ellipse cx="34" cy="8" rx="20" ry="5" fill="#2e1a10"/><path d="M15 10c-22 22-22 76 4 102h30c26-26 26-80 4-102z" fill="url(#ejt)"/><path d="M8 50h52" stroke="#c9a46a" stroke-width="2" opacity=".7"/><ellipse cx="24" cy="62" rx="5" ry="20" fill="#fff" opacity=".14"/></g>
<g transform="translate(176 92)"><ellipse cx="34" cy="7" rx="12" ry="4" fill="#2e1a10"/><path d="M23 9c0 6-2 8-8 14-22 20-18 64 6 80h26c24-16 28-60 6-80-6-6-8-8-8-14z" fill="url(#ejt)"/><path d="M8 52h52" stroke="#c9a46a" stroke-width="2" opacity=".7"/><ellipse cx="24" cy="58" rx="5" ry="18" fill="#fff" opacity=".14"/></g>
<g transform="translate(252 134)"><ellipse cx="25" cy="7" rx="15" ry="4" fill="#2e1a10"/><path d="M11 9c-14 12-14 40 2 52h24c16-12 16-40 2-52z" fill="url(#ejt)"/><ellipse cx="18" cy="32" rx="4" ry="11" fill="#fff" opacity=".14"/></g>
<g font-size="15" font-weight="800" fill="#4a2c18" text-anchor="middle"><text x="52" y="218">독</text><text x="130" y="218">중두리</text><text x="210" y="218">항아리</text><text x="277" y="218">단지</text></g>
<g class="ev-cap" font-size="10.5" font-weight="600" fill="#8a6a4a" text-anchor="middle"><text x="52" y="233">가장 큰 그릇</text><text x="130" y="233">배가 부른 중간 크기</text><text x="210" y="233">좁은 아가리</text><text x="277" y="233">작고 목이 짧음</text></g>
</svg>`,

    beanCycle: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<rect x="0" y="150" width="320" height="58" rx="12" fill="#8a5a3b"/><rect x="0" y="150" width="320" height="10" rx="5" fill="#a8774f"/>
<g fill="#6b4126"><circle cx="30" cy="180" r="3"/><circle cx="110" cy="190" r="2.5"/><circle cx="200" cy="178" r="3"/><circle cx="270" cy="194" r="2.5"/></g>
<ellipse cx="42" cy="150" rx="12" ry="9" fill="#e7c98a" stroke="#b58f4a" stroke-width="2"/><path d="M36 147q6 4 12 0" stroke="#b58f4a" stroke-width="1.6" fill="none"/>
<path d="M118 152v-28" stroke="#5f9e3a" stroke-width="4" stroke-linecap="round"/><ellipse cx="108" cy="122" rx="12" ry="7" fill="#7fc25a" transform="rotate(-25 108 122)"/><ellipse cx="128" cy="122" rx="12" ry="7" fill="#7fc25a" transform="rotate(25 128 122)"/>
<path d="M196 152c0-30 2-56-2-80" stroke="#4f8f32" stroke-width="4.5" fill="none" stroke-linecap="round"/>
<g fill="#6aa84f"><ellipse cx="176" cy="104" rx="15" ry="8" transform="rotate(-30 176 104)"/><ellipse cx="214" cy="96" rx="15" ry="8" transform="rotate(28 214 96)"/><ellipse cx="190" cy="76" rx="13" ry="7" transform="rotate(-60 190 76)"/><ellipse cx="208" cy="124" rx="14" ry="7.5" transform="rotate(20 208 124)"/></g>
<g fill="#b78be0"><circle cx="198" cy="88" r="4.5"/><circle cx="186" cy="118" r="4"/><circle cx="203" cy="108" r="3.6"/></g>
<path d="M272 152c0-30 2-58-2-84" stroke="#7d8f3a" stroke-width="4.5" fill="none" stroke-linecap="round"/>
<g fill="#a6b05a"><ellipse cx="252" cy="96" rx="15" ry="8" transform="rotate(-30 252 96)"/><ellipse cx="290" cy="90" rx="15" ry="8" transform="rotate(28 290 90)"/><ellipse cx="282" cy="120" rx="14" ry="7.5" transform="rotate(20 282 120)"/></g>
<g fill="#c9a85a" stroke="#8f7434" stroke-width="1.5"><rect x="256" y="104" width="10" height="28" rx="5" transform="rotate(14 261 118)"/><rect x="276" y="98" width="10" height="30" rx="5" transform="rotate(-12 281 113)"/><rect x="264" y="126" width="9" height="24" rx="4.5" transform="rotate(30 268 138)"/></g>
<g fill="none" stroke="#c7b08a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M64 140h22m-6-5 6 5-6 5"/><path d="M144 132h22m-6-5 6 5-6 5"/><path d="M226 128h20m-6-5 6 5-6 5"/></g>
<g font-size="12.5" font-weight="800" fill="#fff" text-anchor="middle"><text x="42" y="182">봄</text><text x="118" y="182">싹 트기</text><text x="196" y="182">여름 꽃</text><text x="272" y="182">가을 꼬투리</text></g>
<text class="ev-cap" x="160" y="228" text-anchor="middle" font-size="12" font-weight="600" fill="#5a4636">씨앗 → 싹 → 꽃 → 꼬투리, 콩의 한살이</text>
</svg>`,

    kimchiBuried: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><linearGradient id="ekb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbe9f7"/><stop offset="1" stop-color="#f6f9ff"/></linearGradient><linearGradient id="eks" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6a45"/><stop offset="1" stop-color="#5a3a22"/></linearGradient></defs>
<rect width="320" height="240" rx="18" fill="url(#ekb)"/>
<g fill="#fff"><circle cx="40" cy="30" r="3"/><circle cx="90" cy="54" r="2.5"/><circle cx="150" cy="24" r="3"/><circle cx="214" cy="46" r="2.5"/><circle cx="276" cy="28" r="3"/><circle cx="300" cy="64" r="2"/><circle cx="24" cy="70" r="2"/></g>
<path d="M0 100h320v130a10 10 0 0 1-10 10H10a10 10 0 0 1-10-10z" fill="url(#eks)"/>
<path d="M0 100h320v8H0z" fill="#ffffff"/><path d="M0 108c40 6 80-4 120 2s90 4 130-2 50 2 70 0v4H0z" fill="#e9eef5"/>
<path d="M130 70 L160 42 L190 70z" fill="#d9b45a" stroke="#a8862f" stroke-width="2"/><path d="M134 70h52v32h-52z" fill="#c9a24a" opacity=".55"/>
<g transform="translate(116 104)"><ellipse cx="44" cy="8" rx="30" ry="7" fill="#2e1a10"/><path d="M14 10c-20 26-18 84 10 104h40c28-20 30-78 10-104z" fill="#6b4126"/><path d="M16 48h56" stroke="#c9a46a" stroke-width="2.5" opacity=".7"/><ellipse cx="30" cy="68" rx="6" ry="22" fill="#fff" opacity=".15"/></g>
<g transform="translate(250 130)"><rect x="0" y="0" width="14" height="66" rx="7" fill="#fff" stroke="#9fb4c8" stroke-width="2"/><circle cx="7" cy="72" r="11" fill="#4aa8ff" stroke="#9fb4c8" stroke-width="2"/><rect x="4" y="34" width="6" height="36" rx="3" fill="#4aa8ff"/></g>
<text x="246" y="122" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">서늘하고 고르게</text>
<text x="40" y="150" font-size="12.5" font-weight="700" fill="#fff">땅속</text>
<text class="ev-cap" x="160" y="232" text-anchor="middle" font-size="12" font-weight="600" fill="#f4e6d2">겨울엔 김칫독을 땅에 묻어 온도를 고르게 지켰어요</text>
</svg>`,
  };

  // ---------------------------------------------------------------- contents
  G.data.education = {
    EDU_FERMENT: {
      title: '전통발효란?', cat: 'ferment', category: '발효 기초', icon: '🧫',
      summary: '눈에 보이지 않는 작은 생물, 미생물이 음식을 새로운 맛과 향으로 바꾸는 과정을 알아봐요.',
      pages: [
        {
          title: '발효는 무엇일까요?',
          text: '발효는 효모·곰팡이·세균 같은 미생물이 음식 속 성분을 분해하고 바꾸면서 새로운 맛과 향을 만들어 내는 과정이에요. 같은 콩이라도 발효를 거치면 구수한 된장이 되고, 곡물은 술과 식초로 변하지요.',
          points: ['미생물: 눈으로는 볼 수 없을 만큼 아주 작은 생물', '성분이 분해·변화하면서 맛·향·식감이 달라져요'],
          visual: { type: 'svg', svg: SVG.microbes },
        },
        {
          title: '발효와 부패는 어떻게 다를까요?',
          text: '발효와 부패는 모두 미생물이 일으키는 변화예요. 사람에게 이롭고 먹기 좋은 쪽으로 변하면 발효, 먹을 수 없게 상하면 부패라고 구분해요. 그래서 발효 음식을 만들 때는 알맞은 소금의 양, 온도, 그리고 깨끗함을 잘 지키는 것이 중요해요.',
          points: ['소금·온도·청결 관리가 발효의 핵심', '이로운 미생물이 잘 자라는 환경을 만들어 주기'],
          visual: { type: 'svg', svg: SVG.fermentVsRot },
        },
        {
          title: '우리나라의 발효 음식',
          text: '우리 조상들은 된장·간장·고추장 같은 장류를 비롯해 김치, 젓갈, 식초, 막걸리처럼 다양한 발효 음식을 만들어 왔어요. 제철 재료를 오래 저장하고 맛을 깊게 하는 생활의 지혜가 담겨 있지요.',
          points: ['장류 · 김치 · 젓갈 · 식초 · 전통주', '장독대는 이런 발효 음식을 보관하던 곳이에요'],
          visual: { type: 'model', model: 'jar', caption: '장을 담그는 옹기 항아리' },
        },
        {
          title: '기다림의 음식',
          text: '발효 음식은 짧게는 며칠, 길게는 몇 년에 걸쳐 천천히 익어 가요. 시간이 지나며 맛이 깊어지기 때문에 ‘기다림의 음식’이라고도 불러요. 체험관 속 장독대에서는 이 긴 과정을 짧게 줄여서 체험해 볼 수 있어요.',
          points: ['체험관 속 발효 시간과 수치는 교육용 가상 시뮬레이션이에요'],
          visual: { type: 'svg', svg: SVG.agingTimeline },
        },
      ],
      quiz: 'QZ_FERMENT_1', quizzes: ['QZ_FERMENT_1', 'QZ_FERMENT_2', 'QZ_FERMENT_3'],
      related: ['EDU_JANGDOK', 'EDU_KIMCHI'],
    },

    EDU_JANGDOK: {
      title: '장독대와 옹기', cat: 'onggi', category: '옹기·장독대', icon: '🏺',
      summary: '장을 품어 익히는 장독대, 그리고 ‘숨 쉬는 그릇’이라 불리는 옹기 이야기를 들어 봐요.',
      pages: [
        {
          title: '장독대는 어떤 곳일까요?',
          text: '장독대는 된장·간장·고추장 같은 장을 담은 독과 항아리를 모아 두는 곳이에요. 보통 집 뒤뜰이나 마당 한쪽, 햇볕이 잘 들고 바람이 잘 통하는 자리에 돌을 쌓아 땅보다 조금 높게 만들었어요.',
          points: ['햇볕과 바람이 잘 드는 곳', '빗물이 고이지 않도록 돌로 높게 쌓은 단'],
          visual: { type: 'svg', svg: SVG.jangdokdae },
        },
        {
          title: '숨 쉬는 그릇, 옹기',
          text: '옹기는 흙으로 빚어 높은 온도의 가마에서 구운 그릇이에요. 그릇 벽에 아주 미세한 숨구멍이 있어 공기가 조금씩 드나들기 때문에 ‘숨 쉬는 그릇’이라고 불려요. 이런 특징 덕분에 장을 오래 두고 익히기에 알맞다고 알려져 있어요.',
          points: ['흙으로 빚어 구운 그릇', '미세한 숨구멍으로 공기가 드나들어요'],
          visual: { type: 'model', model: 'jar', caption: '뚜껑을 덮은 옹기 장독 · 드래그해서 돌려 보세요' },
        },
        {
          title: '크기와 모양에 따라 달라지는 이름',
          text: '옹기는 크기와 모양에 따라 이름이 달라요. 가장 큰 ‘독’, 독보다 조금 작고 배가 부른 ‘중두리’, 아가리가 좁고 배가 부른 ‘항아리’, 작고 목이 짧은 ‘단지’ 등이 있어요. 발효주 저장고 앞 전시대에서 실제 모양을 비교해 보세요.',
          points: ['독 · 중두리 · 항아리 · 단지', '발효주 저장고 앞 옹기 전시에서 직접 살펴보기'],
          visual: { type: 'svg', svg: SVG.jarTypes },
        },
        {
          title: '장독을 돌보는 정성',
          text: '맑은 날에는 뚜껑을 열어 햇볕과 바람을 쐬어 주고, 비가 오기 전에는 뚜껑을 덮어 빗물이 들어가지 않게 했어요. 장독 겉면을 깨끗이 닦아 주는 것도 중요한 일이었지요. 체험관 속 내 장독의 ‘환기·햇볕 쬐기·닦기’가 바로 이런 돌봄을 표현한 거예요.',
          points: ['맑은 날: 뚜껑 열고 볕 쬐기', '비 오기 전: 뚜껑 덮기', '겉면을 깨끗하게 닦기'],
          visual: { type: 'model', model: 'jar', opts: { lidOpen: true }, caption: '볕을 쬐려고 뚜껑을 연 장독' },
        },
      ],
      quiz: 'QZ_JANGDOK_1', quizzes: ['QZ_JANGDOK_1', 'QZ_JANGDOK_2', 'QZ_JANGDOK_3'],
      related: ['EDU_FERMENT', 'EDU_DOENJANG'],
    },

    EDU_BEAN: {
      title: '콩과 메주', cat: 'jang', category: '장 담그기', icon: '🫘',
      summary: '모든 장의 출발점인 콩, 그리고 콩을 삶고 찧어 빚는 메주가 어떻게 만들어지는지 알아봐요.',
      pages: [
        {
          title: '장의 시작, 콩',
          text: '된장과 간장, 고추장은 모두 콩에서 시작해요. 우리나라에서는 예로부터 콩을 많이 길러 왔고, 메주를 쑤는 데는 주로 노란 콩(대두)을 썼어요. 콩은 두부, 콩나물, 콩국수 같은 여러 음식의 재료이기도 해요.',
          points: ['장류의 기본 재료는 콩', '메주에는 주로 노란 콩(대두)을 써요'],
          visual: { type: 'model', model: 'bean', caption: '꼬투리가 달린 콩 포기와 콩알' },
        },
        {
          title: '콩밭에서 배우는 콩의 한살이',
          text: '콩은 보통 봄에 씨앗을 뿌리고, 여름 동안 자라 꽃을 피운 뒤 꼬투리가 맺혀요. 가을에 꼬투리가 누렇게 마르면 거두어 털어서 콩알을 얻어요. 콩 뿌리에는 작은 뿌리혹이 생기는데, 이것이 땅을 기름지게 하는 데 도움을 준다고 알려져 있어요.',
          points: ['봄 씨뿌리기 → 여름 꽃 → 가을 거두기', '뿌리혹이 땅을 기름지게 돕는다고 알려져 있어요'],
          visual: { type: 'svg', svg: SVG.beanCycle },
        },
        {
          title: '메주는 어떻게 만들까요?',
          text: '콩을 물에 불려 푹 삶은 다음 절구로 찧어 네모난 덩어리로 빚어요. 겉을 꾸덕하게 말린 뒤 볏짚으로 묶어 따뜻하고 바람이 통하는 곳에 매달아 두면, 볏짚과 공기 중의 미생물이 자리를 잡으며 메주가 ‘떠요’. 메주가 뜬다는 것은 메주가 발효된다는 뜻이에요.',
          points: ['불리기 → 삶기 → 찧기 → 빚기 → 말리기 → 띄우기', '볏짚으로 묶어 바람이 통하는 곳에 매달기'],
          visual: { type: 'model', model: 'meju', caption: '볏짚으로 묶은 메주' },
        },
        {
          title: '메주에서 장으로',
          text: '잘 뜬 메주를 깨끗이 손질해 말린 뒤 소금물과 함께 장독에 담그면 ‘장 담그기’가 시작돼요. 이 한 번의 장 담그기로 된장과 간장을 함께 얻는답니다. 발효식품 구역 작업대에서 수확한 콩으로 메주를 빚어 보세요.',
          points: ['메주 + 소금물 → 장 담그기', '작업대: 콩 3개로 메주 1개 (체험 과정 단순화)'],
          visual: { type: 'steps', items: [{ icon: '🫘', label: '콩' }, { icon: '🧱', label: '메주' }, { icon: '🧂', label: '소금물', sep: '+' }, { icon: '🏺', label: '장 담그기' }], caption: '콩이 장이 되기까지' },
        },
      ],
      quiz: 'QZ_BEAN_1', quizzes: ['QZ_BEAN_1', 'QZ_BEAN_2', 'QZ_BEAN_3'],
      related: ['EDU_DOENJANG', 'EDU_GANJANG', 'EDU_FARMING'],
    },

    EDU_DOENJANG: {
      title: '된장 이야기', cat: 'jang', category: '장 담그기', icon: '🟤',
      summary: '구수한 맛의 된장이 장 담그기와 ‘장 가르기’를 거쳐 어떻게 익어 가는지 알아봐요.',
      pages: [
        {
          title: '된장은 어떤 음식일까요?',
          text: '된장은 메주를 소금물에 담가 두었다가 건져 낸 건더기를 다시 숙성시킨 장이에요. 구수한 맛과 향이 특징이고, 된장찌개·된장국·쌈장처럼 우리 밥상에 자주 오르는 음식에 두루 쓰여요.',
          points: ['재료: 메주 · 소금 · 물', '대표 음식: 된장찌개 · 된장국 · 쌈장'],
          visual: { type: 'model', model: 'doenjang', caption: '옹기 그릇에 담은 된장' },
        },
        {
          title: '장 가르기',
          text: '메주를 소금물에 담그고 얼마간 시간이 지나면 메주 건더기와 검붉은 장물을 나누는데, 이것을 ‘장 가르기’라고 해요. 건더기는 잘 치대어 다시 항아리에 담아 된장으로 익히고, 장물은 간장으로 만들어요.',
          points: ['건더기 → 된장', '장물 → 간장'],
          visual: { type: 'steps', items: [{ icon: '🧱', label: '메주' }, { icon: '🧂', label: '소금물', sep: '+' }, { icon: '✋', label: '장 가르기' }, { icon: '🟤', label: '된장(건더기)' }, { icon: '🫙', label: '간장(장물)', sep: '·' }], caption: '한 번의 장 담그기로 두 가지 장을 얻어요' },
        },
        {
          title: '시간이 만드는 맛',
          text: '된장은 항아리 속에서 오랜 시간 천천히 숙성되며 색이 짙어지고 맛이 깊어져요. 숙성 기간이나 지역, 집집마다의 방법에 따라 맛이 조금씩 달라서 ‘집집마다 장맛이 다르다’는 말도 있지요.',
          points: ['숙성될수록 색은 짙게, 맛은 깊게', '지역과 집마다 다른 장맛'],
          visual: { type: 'model', model: 'jar', caption: '된장이 익어 가는 장독' },
        },
      ],
      quiz: 'QZ_DOENJANG_1', quizzes: ['QZ_DOENJANG_1', 'QZ_DOENJANG_2', 'QZ_DOENJANG_3'],
      related: ['EDU_BEAN', 'EDU_GANJANG'],
    },

    EDU_GANJANG: {
      title: '간장 이야기', cat: 'jang', category: '장 담그기', icon: '🫙',
      summary: '장 가르기에서 얻은 장물이 음식의 간을 맞추는 간장이 되기까지의 이야기예요.',
      pages: [
        {
          title: '간장은 어떻게 만들어질까요?',
          text: '장 가르기 때 메주 건더기를 건져 내고 남은 장물을 따로 모아 숙성시킨 것이 간장이에요. 장물을 한 번 달여서 보관하기도 하는데, 이렇게 하면 더 오래 두고 먹을 수 있어요.',
          points: ['장 가르기 후 남은 장물로 만들어요', '달여서 보관하기도 해요'],
          visual: { type: 'model', model: 'soy', caption: '그릇에 담은 간장' },
        },
        {
          title: '음식의 간을 맞추는 장',
          text: '간장은 짠맛과 감칠맛으로 국, 나물, 조림, 고기 양념 등 여러 음식의 간을 맞추는 데 쓰여요. 담근 지 오래되지 않은 간장은 색이 옅어 국을 끓일 때 많이 쓰고, 오래 묵을수록 색이 짙고 맛이 진해져요.',
          points: ['국 · 나물 · 조림 · 양념', '오래 묵을수록 색이 짙고 맛이 진해져요'],
          visual: { type: 'steps', sep: '', items: [{ icon: '🍲', label: '국' }, { icon: '🥗', label: '나물' }, { icon: '🥘', label: '조림' }, { icon: '🍖', label: '양념' }], caption: '간장이 쓰이는 음식들' },
        },
        {
          title: '간장도 기다림이 필요해요',
          text: '간장 역시 장독 속에서 햇볕과 바람을 받으며 천천히 익어 가요. 맑은 날 뚜껑을 열어 볕을 쬐고, 비 오는 날 덮어 주는 정성이 장맛을 지켜요. 내 장독에서 간장 체험을 시작해 보세요.',
          points: ['장독 돌보기가 장맛을 지켜요'],
          visual: { type: 'model', model: 'jar', opts: { lidOpen: true }, caption: '볕을 쬐는 간장 독' },
        },
      ],
      quiz: 'QZ_GANJANG_1', quizzes: ['QZ_GANJANG_1', 'QZ_GANJANG_2'],
      related: ['EDU_DOENJANG', 'EDU_JANGDOK'],
    },

    EDU_GOCHUJANG: {
      title: '고추장 이야기', cat: 'jang', category: '장 담그기', icon: '🌶️',
      summary: '매운맛과 단맛, 감칠맛이 어우러진 고추장의 재료와 만드는 원리를 알아봐요.',
      pages: [
        {
          title: '매콤달콤한 우리 장',
          text: '고추장은 고춧가루에 익힌 찹쌀(또는 보리·밀 같은 곡물)을 섞고, 메줏가루와 엿기름, 소금 등을 더해 숙성시킨 장이에요. 매운맛과 단맛, 감칠맛이 어우러진 것이 특징이고 비빔밥, 떡볶이, 고추장찌개 등에 쓰여요.',
          points: ['매운맛 + 단맛 + 감칠맛', '대표 음식: 비빔밥 · 떡볶이 · 고추장찌개'],
          visual: { type: 'model', model: 'gochujang', caption: '단지에 담은 고추장' },
        },
        {
          title: '고추장의 재료',
          text: '곡물의 녹말은 엿기름 속 효소의 작용으로 단맛을 내고, 메줏가루는 구수한 맛을 더해요. 여기에 고춧가루의 매운맛과 소금의 짠맛이 어우러지지요. 재료와 비율은 집과 지역마다 조금씩 달라요.',
          points: ['고춧가루 · 찹쌀 · 메줏가루 · 엿기름 · 소금', '엿기름이 단맛을 내는 데 도움을 줘요'],
          visual: { type: 'steps', items: [{ icon: '🌶️', label: '고춧가루' }, { icon: '🍚', label: '찹쌀', sep: '+' }, { icon: '🧱', label: '메줏가루', sep: '+' }, { icon: '🌾', label: '엿기름', sep: '+' }, { icon: '🧂', label: '소금', sep: '+' }, { icon: '🔴', label: '고추장' }], caption: '고추장의 재료 (집집마다 조금씩 달라요)' },
        },
        {
          title: '고추에서 고춧가루로',
          text: '빨갛게 익은 고추를 따서 햇볕에 잘 말린 뒤 빻으면 고춧가루가 돼요. 전통작물 구역에서 기른 고추를 수확해 발효식품 구역 작업대에서 빻아 고춧가루를 만들어 보세요.',
          points: ['익은 고추 → 말리기 → 빻기', '작업대: 고추 3개로 고춧가루 1개 (체험 과정 단순화)'],
          visual: { type: 'model', model: 'pepper', caption: '소쿠리에 담은 고추' },
        },
      ],
      quiz: 'QZ_GOCHUJANG_1', quizzes: ['QZ_GOCHUJANG_1', 'QZ_GOCHUJANG_2'],
      related: ['EDU_BEAN', 'EDU_KIMCHI'],
    },

    EDU_KIMCHI: {
      title: '김치와 발효', cat: 'kimchi', category: '김치', icon: '🥬',
      summary: '채소를 절이고 양념해 익히는 김치, 새콤한 맛을 만드는 젖산 발효와 김장 문화를 만나요.',
      pages: [
        {
          title: '김치는 어떤 음식일까요?',
          text: '김치는 배추나 무 같은 채소를 소금에 절인 뒤 고춧가루·마늘·생강·젓갈 등으로 만든 양념에 버무려 발효시킨 음식이에요. 배추김치, 깍두기, 동치미, 열무김치처럼 재료와 지역에 따라 종류가 아주 많아요.',
          points: ['절이기 → 양념 버무리기 → 익히기', '배추김치 · 깍두기 · 동치미 · 열무김치'],
          visual: { type: 'model', model: 'cabbage', caption: '김치의 주재료, 배추' },
        },
        {
          title: '새콤한 맛의 비밀, 젖산 발효',
          text: '김치가 익어 가는 동안 젖산균이 채소 속 당분을 먹고 젖산을 만들어요. 그래서 시간이 지날수록 새콤한 맛이 나는데, 이 산미가 김치 맛을 이루는 중요한 요소예요.',
          points: ['젖산균이 당분을 젖산으로 바꿔요', '익을수록 새콤해져요'],
          visual: { type: 'model', model: 'kimchi', caption: '김칫독에서 익어 가는 김치' },
        },
        {
          title: '온도가 맛을 바꿔요',
          text: '김치는 온도가 높으면 빨리 익어 금방 시어지고, 서늘하고 낮은 온도에서는 천천히 익어요. 예전에는 겨울 동안 김칫독을 땅에 묻어 온도를 고르게 유지하며 오래 두고 먹었어요.',
          points: ['따뜻하면 빨리, 서늘하면 천천히 익어요', '김칫독을 땅에 묻어 보관했어요'],
          visual: { type: 'svg', svg: SVG.kimchiBuried },
        },
        {
          title: '함께 담그고 나누는 김장',
          text: '겨울을 앞두고 가족과 이웃이 함께 많은 양의 김치를 담그는 것을 ‘김장’이라고 해요. 서로 돕고 나누는 김장 문화는 유네스코 인류무형문화유산으로 등재되어 있어요.',
          points: ['이웃과 함께 담그고 나누는 문화', '유네스코 인류무형문화유산'],
          visual: { type: 'steps', sep: '', items: [{ icon: '👵', label: '할머니' }, { icon: '🧑‍🍳', label: '가족' }, { icon: '🧑‍🤝‍🧑', label: '이웃' }, { icon: '🥬', label: '나눔' }], caption: '김장은 함께하는 일' },
        },
      ],
      quiz: 'QZ_KIMCHI_1', quizzes: ['QZ_KIMCHI_1', 'QZ_KIMCHI_2', 'QZ_KIMCHI_3'],
      related: ['EDU_FERMENT', 'EDU_GOCHUJANG'],
    },

    EDU_FARMING: {
      title: '전통농업과 절기', cat: 'farming', category: '전통농업', icon: '🌾',
      summary: '해의 움직임으로 계절을 나눈 24절기와, 마을이 함께 농사짓던 두레 이야기를 알아봐요.',
      pages: [
        {
          title: '24절기란?',
          text: '24절기는 해의 움직임을 기준으로 한 해를 스물네 마디로 나눈 것으로, 계절의 변화를 알려 주는 달력 역할을 했어요. 농부들은 절기에 맞춰 씨를 뿌리고, 김을 매고, 곡식을 거두었어요.',
          points: ['해의 움직임을 기준으로 나눈 24마디', '농사 일정을 알려 주는 달력'],
          visual: { type: 'model', model: 'season', caption: '사계절과 24절기 · 해가 한 바퀴 돌아요' },
        },
        {
          title: '봄과 여름의 절기',
          text: '입춘은 봄이 시작된다는 뜻이고, 곡우에는 봄비가 내려 곡식을 기름지게 한다고 했어요. 망종은 곡식의 씨를 뿌리기 좋은 때, 하지는 1년 중 낮이 가장 긴 날이에요. 절기 이름에 농사 이야기가 담겨 있지요.',
          points: ['입춘 · 곡우 · 망종 · 하지'],
          visual: { type: 'steps', items: [{ icon: '🌱', label: '입춘' }, { icon: '🌧️', label: '곡우' }, { icon: '🌾', label: '망종' }, { icon: '☀️', label: '하지' }], caption: '봄에서 여름으로' },
        },
        {
          title: '가을과 겨울의 절기',
          text: '입추는 가을의 시작, 추분은 낮과 밤의 길이가 비슷해지는 때예요. 상강에는 서리가 내리기 시작하고, 입동은 겨울의 시작, 동지는 1년 중 밤이 가장 긴 날이에요. 입동 무렵에는 김장을 하는 집이 많았어요.',
          points: ['입추 · 추분 · 상강 · 입동 · 동지', '입동 무렵 김장 준비'],
          visual: { type: 'steps', items: [{ icon: '🍂', label: '입추' }, { icon: '⚖️', label: '추분' }, { icon: '❄️', label: '상강' }, { icon: '⛄', label: '동지' }], caption: '가을에서 겨울로' },
        },
        {
          title: '함께 짓는 농사, 두레',
          text: '모내기나 김매기처럼 일손이 많이 필요할 때는 마을 사람들이 함께 일했어요. 이렇게 서로 돕는 공동 노동 조직을 ‘두레’라고 하고, 일하며 부르는 노동요와 풍물이 흥을 돋웠어요. 전통작물 구역에서 다른 체험객과 함께 밭을 가꿔 보세요.',
          points: ['서로 돕는 공동 노동 조직, 두레', '노동요와 풍물로 흥을 돋워요'],
          visual: { type: 'emoji', emoji: '👨‍🌾🤝👩‍🌾', caption: '함께 일하면 힘든 일도 즐겁게' },
        },
      ],
      quiz: 'QZ_FARMING_1', quizzes: ['QZ_FARMING_1', 'QZ_FARMING_2', 'QZ_FARMING_3'],
      related: ['EDU_BEAN', 'EDU_TOOLS'],
    },

    EDU_TOOLS: {
      title: '전통 농기구', cat: 'tools', category: '전통도구', icon: '🛠️',
      summary: '지게·맷돌·절구·키·호미·시루처럼 옛사람들의 지혜가 담긴 생활 도구를 살펴봐요.',
      pages: [
        {
          title: '등에 지는 운반 도구, 지게',
          text: '지게는 나무로 만든 운반 도구로, 양쪽 어깨에 멜빵을 걸어 등에 지고 짐을 날랐어요. 무거운 짐도 몸 전체로 나누어 질 수 있어서 산과 비탈이 많은 우리 땅에서 특히 많이 쓰였어요.',
          points: ['나무 몸체 + 짚 멜빵', '산길과 비탈길에서도 짐을 나르기 좋아요'],
          visual: { type: 'model', model: 'jige', caption: '지게와 지겟작대기' },
        },
        {
          title: '가는 맷돌, 찧는 절구',
          text: '맷돌은 둥근 돌 두 개를 포개어 위짝을 손잡이로 돌리며 콩이나 곡식을 가는 도구예요. 절구는 우묵한 통에 곡식을 넣고 절굿공이로 찧거나 빻을 때 썼어요. 메주를 만들 때 삶은 콩을 찧는 데도 절구를 사용했지요.',
          points: ['맷돌: 돌려서 갈기', '절구: 내리쳐서 찧기·빻기'],
          visual: { type: 'model', model: 'maetdol', caption: '맷돌 · 드래그해서 돌려 보세요' },
        },
        {
          title: '키 · 호미 · 시루',
          text: '키는 곡식을 까불러 껍질과 티끌을 골라내는 도구, 호미는 김을 매고 흙을 고르는 작은 농기구예요. 시루는 바닥에 구멍이 뚫린 질그릇으로, 솥 위에 올려 떡이나 곡식을 쪄 냈어요. 전통도구 전시장에서 직접 살펴보세요.',
          points: ['키: 까불러 고르기', '호미: 김매기·흙 고르기', '시루: 떡·곡식 찌기'],
          visual: { type: 'steps', sep: '', items: [{ icon: '🧺', label: '키' }, { icon: '⛏️', label: '호미' }, { icon: '🍲', label: '시루' }, { icon: '🥣', label: '절구' }], caption: '전통도구 전시장에서 만나요' },
        },
      ],
      quiz: 'QZ_TOOLS_1', quizzes: ['QZ_TOOLS_1', 'QZ_TOOLS_2', 'QZ_TOOLS_3'],
      related: ['EDU_FARMING', 'EDU_BEAN'],
    },
  };
  for (const [id, e] of Object.entries(G.data.education)) {
    e.id = id;
    e.source = e.source || SRC;
    e.author = e.author || AUTHOR;
    e.referenceDate = e.referenceDate || REF_DATE;
    e.verified = false;
    e.color = e.color || (G.data.educationCategories[e.cat] || {}).color || '#34c36b';
    e.pages.forEach((p, i) => { p.index = i; });
  }

  // ---------------------------------------------------------------- quizzes (reward: first correct answer only)
  const R = () => ({ exp: 100, edu: 10 });
  G.data.quizzes = {
    QZ_FERMENT_1: { edu: 'EDU_FERMENT', question: '발효를 일으키는 주인공은 무엇일까요?', choices: ['미생물', '햇빛', '소금', '바람'], answer: 0, explain: '발효는 효모·곰팡이·세균 같은 미생물이 음식 성분을 분해하고 바꾸는 과정이에요. 햇빛·소금·바람은 발효 환경에 영향을 줄 뿐이에요.' },
    QZ_FERMENT_2: { edu: 'EDU_FERMENT', question: '발효와 부패를 구분하는 기준으로 가장 알맞은 것은?', choices: ['미생물이 있는지 없는지', '사람에게 이롭고 먹기 좋은 변화인지', '색깔이 변했는지', '냄새가 나는지'], answer: 1, explain: '발효와 부패는 모두 미생물이 일으키는 변화예요. 사람에게 이롭고 먹기 좋게 변하면 발효, 먹을 수 없게 상하면 부패라고 해요.' },
    QZ_FERMENT_3: { edu: 'EDU_FERMENT', question: '다음 중 발효 음식이 아닌 것은?', choices: ['김치', '된장', '식초', '생수'], answer: 3, explain: '김치·된장·식초는 모두 미생물의 작용으로 만들어지는 발효 음식이에요. 생수는 발효 과정을 거치지 않아요.' },

    QZ_JANGDOK_1: { edu: 'EDU_JANGDOK', question: '옹기를 ‘숨 쉬는 그릇’이라고 부르는 까닭은?', choices: ['그릇 벽에 미세한 숨구멍이 있어서', '살아 있는 생물로 만들어서', '뚜껑에 큰 구멍이 뚫려 있어서', '물에 넣으면 거품이 나서'], answer: 0, explain: '옹기는 흙으로 빚어 구운 그릇으로, 그릇 벽의 미세한 숨구멍으로 공기가 조금씩 드나들어 ‘숨 쉬는 그릇’이라고 불려요.' },
    QZ_JANGDOK_2: { edu: 'EDU_JANGDOK', question: '장독대를 두기에 가장 알맞은 곳은?', choices: ['습하고 그늘진 지하실', '햇볕이 잘 들고 바람이 잘 통하는 곳', '물이 고이는 낮은 땅', '아궁이 바로 옆'], answer: 1, explain: '장독대는 햇볕이 잘 들고 바람이 잘 통하는 곳에, 빗물이 고이지 않도록 돌을 쌓아 높게 만들었어요.' },
    QZ_JANGDOK_3: { edu: 'EDU_JANGDOK', question: '옹기 가운데 아가리가 좁고 배가 부른 그릇의 이름은?', choices: ['시루', '단지', '항아리', '소쿠리'], answer: 2, explain: '아가리가 좁고 배가 부른 옹기를 항아리라고 해요. 단지는 작고 목이 짧은 그릇, 시루는 떡을 찌는 그릇이에요.' },

    QZ_BEAN_1: { edu: 'EDU_BEAN', question: '메주를 만드는 순서로 알맞은 것은?', choices: ['콩 볶기 → 갈기 → 끓이기 → 얼리기', '콩 씻기 → 튀기기 → 자르기 → 굽기', '콩 삶기 → 찧기 → 빚기 → 말려 띄우기', '콩 불리기 → 싹 틔우기 → 말리기 → 빻기'], answer: 2, explain: '메주는 불린 콩을 푹 삶아 찧은 뒤 네모나게 빚고, 말려서 볏짚에 묶어 띄워 만들어요.' },
    QZ_BEAN_2: { edu: 'EDU_BEAN', question: '메주를 볏짚으로 묶어 매달아 두는 까닭으로 가장 알맞은 것은?', choices: ['모양을 예쁘게 하려고', '바람이 잘 통하고 볏짚의 미생물이 발효를 돕도록', '벌레를 쫓으려고', '무게를 재려고'], answer: 1, explain: '볏짚에는 발효를 돕는 미생물이 많이 산다고 알려져 있어요. 매달아 두면 바람도 잘 통해 메주가 고르게 마르고 잘 떠요.' },
    QZ_BEAN_3: { edu: 'EDU_BEAN', question: '콩 뿌리에 생기는 뿌리혹이 하는 일로 알려진 것은?', choices: ['꽃을 피운다', '땅을 기름지게 돕는다', '열매를 단단하게 만든다', '벌레를 잡아먹는다'], answer: 1, explain: '콩 뿌리의 뿌리혹은 땅을 기름지게 하는 데 도움을 준다고 알려져 있어요. 그래서 콩을 기르면 밭이 좋아진다는 말이 전해져요.' },

    QZ_DOENJANG_1: { edu: 'EDU_DOENJANG', question: '된장과 관련이 깊은 재료는?', choices: ['콩', '사과', '딸기', '바나나'], answer: 0, explain: '된장은 콩을 삶아 빚은 메주로 만들어요. 콩은 된장·간장·고추장 같은 장류의 기본 재료랍니다.' },
    QZ_DOENJANG_2: { edu: 'EDU_DOENJANG', question: '장을 담근 뒤 메주 건더기와 장물을 나누는 일을 무엇이라고 할까요?', choices: ['김장', '모내기', '장 가르기', '타작'], answer: 2, explain: '메주 건더기와 장물을 나누는 일을 ‘장 가르기’라고 해요. 건더기는 된장, 장물은 간장이 돼요.' },
    QZ_DOENJANG_3: { edu: 'EDU_DOENJANG', question: '장 가르기 후 메주 건더기로 만드는 장은?', choices: ['간장', '된장', '식초', '젓갈'], answer: 1, explain: '장 가르기 후 건더기를 치대어 다시 숙성시킨 것이 된장이에요. 남은 장물로는 간장을 만들어요.' },

    QZ_GANJANG_1: { edu: 'EDU_GANJANG', question: '간장은 장 담그기의 어느 부분으로 만들까요?', choices: ['메주 건더기', '콩깍지', '볏짚', '메주를 건져 내고 남은 장물'], answer: 3, explain: '장 가르기 때 메주 건더기를 건져 내고 남은 장물을 숙성시킨 것이 간장이에요.' },
    QZ_GANJANG_2: { edu: 'EDU_GANJANG', question: '간장의 쓰임으로 가장 알맞은 것은?', choices: ['음식의 간을 맞춘다', '옷감을 물들인다', '장독을 닦는다', '씨앗을 소독한다'], answer: 0, explain: '간장은 짠맛과 감칠맛으로 국, 나물, 조림, 양념 등 여러 음식의 간을 맞추는 데 쓰여요.' },

    QZ_GOCHUJANG_1: { edu: 'EDU_GOCHUJANG', question: '고추장을 만드는 재료가 아닌 것은?', choices: ['고춧가루', '찹쌀', '메줏가루', '우유'], answer: 3, explain: '고추장은 고춧가루, 찹쌀 같은 곡물, 메줏가루, 엿기름, 소금 등으로 만들어요. 우유는 들어가지 않아요.' },
    QZ_GOCHUJANG_2: { edu: 'EDU_GOCHUJANG', question: '고춧가루는 어떻게 만들까요?', choices: ['고추를 물에 끓인다', '익은 고추를 말려서 빻는다', '고추를 얼린다', '고춧잎을 갈아 만든다'], answer: 1, explain: '빨갛게 익은 고추를 햇볕에 잘 말린 뒤 빻으면 고춧가루가 돼요.' },

    QZ_KIMCHI_1: { edu: 'EDU_KIMCHI', question: '김치가 익으며 새콤해지는 것은 어떤 미생물 덕분일까요?', choices: ['곰팡이', '바이러스', '젖산균', '짚신벌레'], answer: 2, explain: '김치가 익는 동안 젖산균이 채소 속 당분을 젖산으로 바꾸어 새콤한 맛이 나요.' },
    QZ_KIMCHI_2: { edu: 'EDU_KIMCHI', question: '겨울을 앞두고 가족과 이웃이 함께 김치를 많이 담그는 일은?', choices: ['단오', '김장', '장 가르기', '추수'], answer: 1, explain: '겨울을 앞두고 함께 김치를 담그고 나누는 일을 김장이라고 해요. 김장 문화는 유네스코 인류무형문화유산으로 등재되어 있어요.' },
    QZ_KIMCHI_3: { edu: 'EDU_KIMCHI', question: '김치를 천천히 익히고 싶을 때 알맞은 보관 방법은?', choices: ['서늘하고 낮은 온도에 둔다', '햇볕이 드는 따뜻한 곳에 둔다', '뚜껑을 활짝 열어 둔다', '물을 가득 붓는다'], answer: 0, explain: '김치는 따뜻하면 빨리 익고 서늘하면 천천히 익어요. 그래서 예전에는 김칫독을 땅에 묻어 온도를 고르게 지켰어요.' },

    QZ_FARMING_1: { edu: 'EDU_FARMING', question: '24절기는 무엇을 기준으로 한 해를 나눈 것일까요?', choices: ['해의 움직임', '바닷물의 높이', '바람의 세기', '별의 개수'], answer: 0, explain: '24절기는 해의 움직임을 기준으로 한 해를 스물네 마디로 나눈 것으로, 농사 시기를 알려 주는 달력 역할을 했어요.' },
    QZ_FARMING_2: { edu: 'EDU_FARMING', question: '1년 중 낮의 길이가 가장 긴 절기는?', choices: ['동지', '하지', '춘분', '입추'], answer: 1, explain: '하지는 1년 중 낮이 가장 긴 날이고, 동지는 밤이 가장 긴 날이에요.' },
    QZ_FARMING_3: { edu: 'EDU_FARMING', question: '마을 사람들이 함께 농사일을 하던 공동 노동 조직은?', choices: ['장터', '서당', '향교', '두레'], answer: 3, explain: '모내기·김매기처럼 일손이 많이 필요할 때 마을 사람들이 함께 일하던 조직을 두레라고 해요.' },

    QZ_TOOLS_1: { edu: 'EDU_TOOLS', question: '나무로 만들어 등에 지고 짐을 나르던 도구는?', choices: ['지게', '맷돌', '시루', '키'], answer: 0, explain: '지게는 나무 몸체에 짚 멜빵을 달아 등에 지고 짐을 나르던 운반 도구예요.' },
    QZ_TOOLS_2: { edu: 'EDU_TOOLS', question: '둥근 돌 두 개를 포개어 돌리며 콩이나 곡식을 가는 도구는?', choices: ['호미', '맷돌', '절구', '지게'], answer: 1, explain: '맷돌은 위짝을 손잡이로 돌려 콩이나 곡식을 가는 돌 도구예요. 절구는 내리쳐서 찧는 도구예요.' },
    QZ_TOOLS_3: { edu: 'EDU_TOOLS', question: '곡식을 까불러 껍질과 티끌을 골라내는 도구는?', choices: ['시루', '호미', '키', '절구'], answer: 2, explain: '키는 곡식을 담아 위아래로 까불러 가벼운 껍질과 티끌을 날려 보내는 도구예요.' },
  };
  for (const [id, q] of Object.entries(G.data.quizzes)) {
    q.id = id;
    q.reward = q.reward || R();
  }

  // ---------------------------------------------------------------- exhibit food cards (fermentation zone tables)
  G.data.exhibitInfo = {
    EXH_DOENJANG: {
      model: 'doenjang', tagline: '구수한 맛의 기본 장',
      text: '메주를 소금물에 담갔다가 건져 낸 건더기를 숙성시킨 장이에요. 오래 익을수록 색이 짙어지고 맛이 깊어져요.',
      facts: [['주재료', '메주 · 소금 · 물'], ['맛', '구수하고 짭짤해요'], ['대표 음식', '된장찌개 · 된장국 · 쌈장']],
    },
    EXH_GANJANG: {
      model: 'soy', tagline: '음식의 간을 맞추는 장',
      text: '장 가르기 때 메주를 건져 내고 남은 장물을 숙성시킨 장이에요. 국, 나물, 조림 등 여러 음식에 두루 쓰여요.',
      facts: [['주재료', '메주를 담근 장물'], ['맛', '짭짤하고 감칠맛이 나요'], ['쓰임', '국 · 나물 · 조림 · 양념']],
    },
    EXH_GOCHUJANG: {
      model: 'gochujang', tagline: '매콤달콤한 우리 장',
      text: '고춧가루와 익힌 곡물, 메줏가루, 엿기름, 소금 등을 섞어 숙성시킨 장이에요. 매운맛과 단맛, 감칠맛이 어우러져요.',
      facts: [['주재료', '고춧가루 · 찹쌀 · 메줏가루 · 엿기름 · 소금'], ['맛', '맵고 달콤하며 감칠맛'], ['대표 음식', '비빔밥 · 떡볶이 · 고추장찌개']],
    },
    EXH_KIMCHI: {
      model: 'kimchi', tagline: '젖산 발효로 익는 채소 음식',
      text: '절인 채소를 양념에 버무려 발효시킨 음식이에요. 젖산균이 만드는 새콤한 맛이 특징이고 종류가 아주 다양해요.',
      facts: [['주재료', '배추 · 무 · 고춧가루 · 마늘 · 젓갈'], ['발효', '젖산균에 의한 젖산 발효'], ['종류', '배추김치 · 깍두기 · 동치미 · 열무김치']],
    },
    EXH_VINEGAR: {
      model: 'vinegar', tagline: '술이 한 번 더 발효된 맛',
      text: '곡물이나 과일로 빚은 술을 초산균이 한 번 더 발효시켜 만든 식초예요. 새콤한 맛으로 무침과 냉국 등에 쓰여요.',
      facts: [['주재료', '곡물이나 과일로 빚은 술'], ['발효', '초산균이 술을 식초로 바꿔요'], ['쓰임', '무침 · 냉국 · 절임']],
    },
  };

  // ---------------------------------------------------------------- traditional tools display (layout.tools: quest Q_CULTURE + 도감)
  G.data.toolInfo = {
    TOOL_JIGE: {
      model: 'jige', icon: '🪵', tagline: '등에 지는 운반 도구',
      text: '나무 몸체에 짚으로 엮은 멜빵을 달아 등에 지고 짐을 날랐어요. 무거운 짐도 몸 전체로 나누어 질 수 있어서 산과 비탈이 많은 우리 땅에서 많이 쓰였어요.',
      facts: [['재료', '나무 · 짚 멜빵'], ['쓰임', '나무 · 곡식 · 짐 나르기'], ['짝꿍', '지겟작대기']],
    },
    TOOL_MAETDOL: {
      model: 'maetdol', icon: '🪨', tagline: '돌려서 가는 돌 도구',
      text: '둥근 돌 두 개를 포개고 위짝의 손잡이를 돌리면, 구멍으로 넣은 콩이나 곡식이 곱게 갈려 나와요. 두부를 만들 콩을 갈 때도 썼어요.',
      facts: [['재료', '돌'], ['쓰임', '콩 · 곡식 갈기'], ['쓰는 법', '위짝을 빙글빙글 돌리기']],
    },
    TOOL_JEOLGU: {
      icon: '🥣', tagline: '찧고 빻는 도구',
      text: '우묵한 통에 곡식을 넣고 절굿공이로 내리쳐 찧거나 빻는 도구예요. 메주를 만들 때 삶은 콩을 찧는 데도 썼어요.',
      facts: [['재료', '나무 · 돌'], ['쓰임', '곡식 찧기 · 콩 으깨기'], ['짝꿍', '절굿공이']],
    },
    TOOL_KI: {
      icon: '🧺', tagline: '까불러 고르는 도구',
      text: '곡식을 담아 위아래로 까부르면 가벼운 껍질과 티끌은 바람에 날아가고 무거운 알곡만 남아요.',
      facts: [['재료', '대나무 · 버들가지'], ['쓰임', '껍질 · 티끌 골라내기'], ['쓰는 법', '위아래로 까부르기']],
    },
    TOOL_HOMI: {
      icon: '⛏️', tagline: '김매는 작은 농기구',
      text: '손에 쥐고 김을 매거나 흙을 고르고, 모종을 심을 구멍을 팔 때 쓰는 작은 농기구예요. 지금도 텃밭에서 많이 써요.',
      facts: [['재료', '쇠 날 · 나무 손잡이'], ['쓰임', '김매기 · 흙 고르기'], ['특징', '한 손에 쏙 들어와요']],
    },
    TOOL_SIRU: {
      icon: '🍲', tagline: '떡을 찌는 질그릇',
      text: '바닥에 작은 구멍이 여러 개 뚫린 질그릇이에요. 물이 끓는 솥 위에 올리면 뜨거운 김이 구멍으로 올라와 떡이나 곡식을 쪄 줘요.',
      facts: [['재료', '흙으로 빚은 질그릇'], ['쓰임', '떡 · 곡식 찌기'], ['특징', '바닥의 작은 구멍들']],
    },
  };

  // ---------------------------------------------------------------- hall guide (HALL_DOOR)
  G.data.hallGuide = {
    title: '전통발효체험관 안내',
    intro: '현대식 유리 전시관과 한옥 지붕이 어우러진 체험관 본관이에요. 층마다 마련된 전시를 교육 콘텐츠로 살펴볼 수 있어요.',
    floors: [
      { floor: '3F', name: '전망 라운지', icon: '🏔️', color: '#6fb6e8', desc: '산과 계곡, 장독대와 전통작물 밭을 한눈에 내려다보는 라운지예요. 절기에 따라 달라지는 들판과 옛 농기구 이야기를 만나 보세요.', edu: ['EDU_FARMING', 'EDU_TOOLS'] },
      { floor: '2F', name: '체험 교실', icon: '🧑‍🏫', color: '#7fbf5a', desc: '메주 빚기와 장 담그기, 김치 담그기 과정을 단계별로 배우는 교실이에요. 배운 뒤에는 퀴즈로 실력을 확인해 보세요.', edu: ['EDU_BEAN', 'EDU_GANJANG', 'EDU_GOCHUJANG', 'EDU_KIMCHI'] },
      { floor: '1F', name: '발효 전시실', icon: '🏺', color: '#e0a35a', desc: '장류·김치·식초 같은 발효 음식과 다양한 옹기를 전시하는 공간이에요. 발효의 기본 원리와 장독대 문화를 소개해요.', edu: ['EDU_FERMENT', 'EDU_JANGDOK', 'EDU_DOENJANG'] },
    ],
    note: '실제 체험관 운영 정보(관람 시간·요금 등)는 이 체험관 속 내용과 무관하며 별도로 확인해야 해요.',
  };

  // ---------------------------------------------------------------- 쉬운 모드 (CONTRACT §12): kid versions
  // content.kid = { title, summary (2–3 short sentences + emoji), slides:[3 × { text, vis:pageIndex | steps:[[icon,label]] | emoji }] }
  //   vis reuses that page's picture (3D model / illustration); steps draws a picture row; emoji shows one big picture.
  // quiz.kid    = { q, choices:[{e, t}] (2–3 pictures), answer, hint, why }  or  { q, ox:true, answer:true|false, hint, why }
  //   The kid quiz is the same quiz id: rewards stay "first correct answer only" (server SaveValidator unchanged).
  const KID_EDU = {
    EDU_FERMENT: {
      title: '발효가 뭐예요?', summary: '눈에 안 보이는 작은 친구, 미생물이 음식을 맛있게 바꿔요! 🦠✨',
      slides: [
        { vis: 0, text: '아주아주 작은 친구들이 있어요. 미생물이라고 불러요 🦠' },
        { steps: [['🫘', '콩'], ['🦠', '미생물'], ['🟤', '된장']], text: '미생물이 콩을 바꾸면 구수한 된장이 돼요!' },
        { vis: 3, text: '천천히 기다릴수록 맛이 더 깊어져요 ⏳' },
      ],
    },
    EDU_JANGDOK: {
      title: '장독대와 옹기', summary: '장독대는 맛있는 장이 사는 집이에요. 옹기는 숨을 쉬는 그릇이에요 🏺',
      slides: [
        { vis: 0, text: '햇볕 잘 들고 바람 솔솔 부는 곳에 장독을 모아 둬요 ☀️' },
        { vis: 1, text: '옹기는 흙으로 만든 그릇이에요. 작은 숨구멍으로 숨을 쉬어요 🌬️' },
        { vis: 3, text: '맑은 날엔 뚜껑을 열고, 비가 오면 꼭 덮어 줘요 ☔' },
      ],
    },
    EDU_BEAN: {
      title: '콩과 메주', summary: '모든 장은 콩에서 시작해요. 콩을 삶고 찧어서 메주를 만들어요 🫘',
      slides: [
        { vis: 0, text: '된장, 간장, 고추장은 모두 콩으로 만들어요 🫘' },
        { vis: 1, text: '봄에 심은 콩이 쑥쑥 자라서 가을에 콩알이 열려요 🌱' },
        { vis: 2, text: '콩을 삶고 콩콩 찧어서 네모난 메주를 만들어요 🧱' },
      ],
    },
    EDU_DOENJANG: {
      title: '된장 이야기', summary: '된장은 메주로 만든 구수한 장이에요. 된장찌개 맛있죠? 🍲',
      slides: [
        { vis: 0, text: '된장은 구수한 맛이 나는 장이에요 🟤' },
        { steps: [['🧱', '메주'], ['🧂', '소금물'], ['🟤', '된장'], ['🫙', '간장']], text: '메주를 소금물에 담갔다가 나누면 된장과 간장이 돼요!' },
        { emoji: '🍲😋', text: '된장찌개랑 된장국을 끓일 때 써요. 냠냠!' },
      ],
    },
    EDU_GANJANG: {
      title: '간장 이야기', summary: '간장은 음식을 알맞게 짭짤하게 해 줘요 🫙',
      slides: [
        { vis: 0, text: '메주를 건져 내고 남은 까만 물로 간장을 만들어요 🫙' },
        { vis: 1, text: '국이랑 나물에 조금 넣으면 맛있어져요 🍲' },
        { vis: 2, text: '간장도 장독에서 햇볕을 쬐며 천천히 익어요 ☀️' },
      ],
    },
    EDU_GOCHUJANG: {
      title: '고추장 이야기', summary: '고추장은 맵고 달콤한 빨간 장이에요 🌶️',
      slides: [
        { vis: 0, text: '고추장은 맵고 달콤한 빨간 장이에요 🔴' },
        { steps: [['🌶️', '고춧가루'], ['🍚', '찹쌀'], ['🧱', '메주'], ['🔴', '고추장']], text: '고춧가루랑 찹쌀이랑 메주를 섞어서 만들어요!' },
        { vis: 2, text: '빨간 고추를 햇볕에 말리고 빻으면 고춧가루가 돼요 ☀️' },
      ],
    },
    EDU_KIMCHI: {
      title: '김치 이야기', summary: '배추를 절이고 양념에 버무려 익히면 새콤한 김치가 돼요 🥬',
      slides: [
        { vis: 0, text: '배추를 소금에 절이고 빨간 양념을 발라요 🥬' },
        { vis: 1, text: '작은 젖산균 친구가 김치를 새콤하게 만들어요 😋' },
        { vis: 3, text: '겨울이 오기 전에 다 같이 김장을 하고 나눠 먹어요 🤝' },
      ],
    },
    EDU_FARMING: {
      title: '절기와 농사', summary: '해님을 보고 계절을 나누어 씨를 뿌리고 거두었어요 🌞',
      slides: [
        { vis: 0, text: '해님의 움직임을 보고 일 년을 스물네 마디로 나눴어요 🌞' },
        { steps: [['🌱', '봄'], ['☀️', '여름'], ['🍂', '가을'], ['⛄', '겨울']], text: '봄에는 씨를 뿌리고, 가을에는 곡식을 거둬요 🌾' },
        { vis: 3, text: '마을 사람들이 다 같이 도우며 농사를 지었어요. 두레라고 해요 🤝' },
      ],
    },
    EDU_TOOLS: {
      title: '옛날 도구', summary: '옛날 사람들은 지게, 맷돌, 호미 같은 도구로 일했어요 🛠️',
      slides: [
        { vis: 0, text: '지게는 등에 메고 무거운 짐을 나르는 도구예요 🪵' },
        { vis: 1, text: '맷돌은 빙글빙글 돌려서 콩을 가는 돌이에요 🪨' },
        { vis: 2, text: '키, 호미, 시루, 절구도 있어요. 전시장에서 찾아봐요! 🔍' },
      ],
    },
  };
  const KID_QUIZ = {
    QZ_FERMENT_1: { q: '발효를 일으키는 작은 친구는 누구일까요?', choices: [{ e: '🦠', t: '미생물' }, { e: '☀️', t: '햇빛' }, { e: '💨', t: '바람' }], answer: 0, hint: '눈에 안 보이는 아주 작은 친구예요 🔍', why: '미생물이 음식을 맛있게 바꿔 줘요!' },
    QZ_FERMENT_2: { q: '발효는 음식을 먹기 좋게 바꾸는 거예요. 맞을까요?', ox: true, answer: true, hint: '된장이랑 김치를 떠올려 봐요 🟤', why: '맞아요! 상해서 못 먹게 되면 부패라고 해요.' },
    QZ_FERMENT_3: { q: '발효 음식이 아닌 것은 무엇일까요?', choices: [{ e: '🥬', t: '김치' }, { e: '🟤', t: '된장' }, { e: '💧', t: '물' }], answer: 2, hint: '그대로 꿀꺽 마시는 거예요 💧', why: '물은 발효하지 않아요. 김치랑 된장은 발효 음식이에요!' },
    QZ_JANGDOK_1: { q: '옹기를 왜 숨 쉬는 그릇이라고 할까요?', choices: [{ e: '🌬️', t: '작은 숨구멍이 있어서' }, { e: '🐟', t: '물고기가 살아서' }], answer: 0, hint: '그릇 벽에 아주 작은 구멍이 있어요 🔍', why: '맞아요! 작은 숨구멍으로 공기가 솔솔 드나들어요.' },
    QZ_JANGDOK_2: { q: '장독대는 어디에 두면 좋을까요?', choices: [{ e: '☀️', t: '햇볕 잘 드는 곳' }, { e: '🌑', t: '깜깜한 곳' }, { e: '💦', t: '물웅덩이' }], answer: 0, hint: '장독은 햇볕을 좋아해요 ☀️', why: '햇볕 잘 들고 바람 잘 통하는 곳이 좋아요!' },
    QZ_JANGDOK_3: { q: '배가 볼록하고 입구가 좁은 옹기는 무엇일까요?', choices: [{ e: '🏺', t: '항아리' }, { e: '🧺', t: '소쿠리' }, { e: '🍲', t: '시루' }], answer: 0, hint: '고추장을 담아 두는 볼록한 그릇이에요 🏺', why: '맞아요! 볼록한 배의 항아리예요.' },
    QZ_BEAN_1: { q: '메주는 무엇으로 만들까요?', choices: [{ e: '🫘', t: '콩' }, { e: '🍎', t: '사과' }, { e: '🥕', t: '당근' }], answer: 0, hint: '장은 모두 이걸로 시작해요 🫘', why: '콩을 삶고 찧어서 메주를 만들어요!' },
    QZ_BEAN_2: { q: '메주는 깜깜하고 축축한 통 속에 꼭꼭 숨겨 둬요. 맞을까요?', ox: true, answer: false, hint: '메주도 바람을 좋아해요 🌬️', why: '메주는 볏짚으로 묶어서 바람이 솔솔 부는 곳에 매달아요!' },
    QZ_BEAN_3: { q: '콩 뿌리에 붙은 작은 혹은 무엇을 도울까요?', choices: [{ e: '🌱', t: '땅을 튼튼하게' }, { e: '🐛', t: '벌레 잡기' }], answer: 0, hint: '콩을 심으면 밭이 좋아진대요 🌱', why: '맞아요! 땅을 기름지게 도와준대요.' },
    QZ_DOENJANG_1: { q: '된장은 무엇으로 만들까요?', choices: [{ e: '🫘', t: '콩' }, { e: '🍓', t: '딸기' }, { e: '🍌', t: '바나나' }], answer: 0, hint: '메주를 만드는 재료예요 🧱', why: '콩으로 만든 메주로 된장을 만들어요!' },
    QZ_DOENJANG_2: { q: '메주 건더기와 장물을 나누는 일은 무엇일까요?', choices: [{ e: '✋', t: '장 가르기' }, { e: '🥬', t: '김장' }, { e: '🌾', t: '모내기' }], answer: 0, hint: '나눈다는 말은 "가르다"예요 ✋', why: '맞아요! 장 가르기라고 해요.' },
    QZ_DOENJANG_3: { q: '메주 건더기로 만드는 장은 무엇일까요?', choices: [{ e: '🟤', t: '된장' }, { e: '🫙', t: '간장' }], answer: 0, hint: '건더기는 꾸덕꾸덕해요 🟤', why: '건더기는 된장, 까만 물은 간장이 돼요!' },
    QZ_GANJANG_1: { q: '간장은 무엇으로 만들까요?', choices: [{ e: '🫙', t: '메주를 건지고 남은 물' }, { e: '🌾', t: '볏짚' }], answer: 0, hint: '메주를 건져 내고 남은 까만 물이에요 🫙', why: '맞아요! 남은 장물을 익히면 간장이 돼요.' },
    QZ_GANJANG_2: { q: '간장은 어디에 쓸까요?', choices: [{ e: '🍲', t: '음식 맛 내기' }, { e: '👕', t: '옷 물들이기' }, { e: '🧽', t: '장독 닦기' }], answer: 0, hint: '부엌에서 쓰는 거예요 🍲', why: '맞아요! 국이랑 나물을 맛있게 해 줘요.' },
    QZ_GOCHUJANG_1: { q: '고추장에 들어가지 않는 것은 무엇일까요?', choices: [{ e: '🌶️', t: '고춧가루' }, { e: '🍚', t: '찹쌀' }, { e: '🥛', t: '우유' }], answer: 2, hint: '하얗고 소한테서 나와요 🐄', why: '맞아요! 고추장에는 우유가 안 들어가요.' },
    QZ_GOCHUJANG_2: { q: '고춧가루는 어떻게 만들까요?', choices: [{ e: '☀️', t: '고추를 말려서 빻아요' }, { e: '🧊', t: '고추를 꽁꽁 얼려요' }], answer: 0, hint: '햇볕에 바싹 말려요 ☀️', why: '빨간 고추를 말려서 빻으면 고춧가루가 돼요!' },
    QZ_KIMCHI_1: { q: '김치를 새콤하게 만드는 친구는 누구일까요?', choices: [{ e: '🦠', t: '젖산균' }, { e: '🐸', t: '개구리' }, { e: '🦋', t: '나비' }], answer: 0, hint: '눈에 안 보이는 작은 친구예요 🦠', why: '젖산균이 김치를 새콤하게 만들어요!' },
    QZ_KIMCHI_2: { q: '겨울이 오기 전에 다 같이 김치를 담그는 일은?', choices: [{ e: '🥬', t: '김장' }, { e: '🎂', t: '생일 잔치' }, { e: '🎄', t: '성탄절' }], answer: 0, hint: '김치의 "김"으로 시작해요 🥬', why: '맞아요! 김장이에요. 이웃이랑 나눠 먹어요.' },
    QZ_KIMCHI_3: { q: '김치는 따뜻한 곳에 두면 더 천천히 익어요. 맞을까요?', ox: true, answer: false, hint: '냉장고를 떠올려 봐요 🧊', why: '김치는 따뜻하면 빨리, 서늘하면 천천히 익어요!' },
    QZ_FARMING_1: { q: '24절기는 무엇을 보고 나눴을까요?', choices: [{ e: '🌞', t: '해님' }, { e: '🌊', t: '바닷물' }, { e: '⭐', t: '별 개수' }], answer: 0, hint: '하늘에서 반짝 빛나고 따뜻해요 🌞', why: '해님의 움직임을 보고 나눴어요!' },
    QZ_FARMING_2: { q: '낮이 가장 긴 날은 언제일까요?', choices: [{ e: '☀️', t: '하지' }, { e: '⛄', t: '동지' }], answer: 0, hint: '여름에 있어요 ☀️', why: '하지는 낮이 제일 길고, 동지는 밤이 제일 길어요!' },
    QZ_FARMING_3: { q: '마을 사람들이 다 같이 농사짓던 모임은?', choices: [{ e: '🤝', t: '두레' }, { e: '🏫', t: '서당' }], answer: 0, hint: '서로 돕는 모임이에요 🤝', why: '맞아요! 두레라고 해요.' },
    QZ_TOOLS_1: { q: '등에 메고 짐을 나르는 도구는 무엇일까요?', choices: [{ e: '🪵', t: '지게' }, { e: '🪨', t: '맷돌' }, { e: '🧺', t: '키' }], answer: 0, hint: '나무로 만들고 등에 메요 🎒', why: '지게예요! 무거운 짐도 거뜬해요.' },
    QZ_TOOLS_2: { q: '빙글빙글 돌려서 콩을 가는 돌은 무엇일까요?', choices: [{ e: '🪨', t: '맷돌' }, { e: '⛏️', t: '호미' }], answer: 0, hint: '돌 두 개가 겹쳐 있어요 🪨', why: '맷돌이에요! 빙글빙글 돌려서 갈아요.' },
    QZ_TOOLS_3: { q: '곡식을 까불러 껍질을 날리는 도구는 무엇일까요?', choices: [{ e: '🧺', t: '키' }, { e: '🍲', t: '시루' }, { e: '🥣', t: '절구' }], answer: 0, hint: '넓적하고 위아래로 흔들어요 🧺', why: '키예요! 가벼운 껍질이 훨훨 날아가요.' },
  };
  const KID_EXHIBIT = {
    EXH_DOENJANG: '구수한 된장이에요. 된장찌개를 끓일 때 써요 🍲',
    EXH_GANJANG: '까만 간장이에요. 음식을 알맞게 짭짤하게 해 줘요 🫙',
    EXH_GOCHUJANG: '맵고 달콤한 빨간 고추장이에요. 비빔밥에 넣어요 🌶️',
    EXH_KIMCHI: '새콤한 김치예요. 배추에 빨간 양념을 발라 익혀요 🥬',
    EXH_VINEGAR: '새콤한 식초예요. 술이 한 번 더 익어서 돼요 🍶',
  };
  const KID_TOOLS = {
    TOOL_JIGE: '지게예요. 등에 메고 무거운 짐을 날라요 🪵',
    TOOL_MAETDOL: '맷돌이에요. 빙글빙글 돌려서 콩을 갈아요 🪨',
    TOOL_JEOLGU: '절구예요. 쿵쿵 찧어서 콩을 으깨요 🥣',
    TOOL_KI: '키예요. 흔들흔들 껍질을 날려 보내요 🧺',
    TOOL_HOMI: '호미예요. 풀을 뽑고 흙을 골라요 ⛏️',
    TOOL_SIRU: '시루예요. 뜨거운 김으로 떡을 쪄요 🍡',
  };
  // 쉬운 모드 words for the plain info signboards (layout.signs action 'info'); other signs open content or the map
  G.data.kidSigns = {
    SIGN_HERB: { title: '허브 밭', text: '향긋한 허브가 자라는 밭이에요. 허브는 물을 조금만 줘도 잘 자라요 🌿' },
    SIGN_STORAGE: { title: '장 창고', text: '커다란 장독에 장을 모아 두는 곳이에요. 옹기를 구경해 봐요 🏺' },
    SIGN_EDU: { title: '배우는 집', text: '화면을 눌러 발효 이야기를 듣고 퀴즈도 풀어요 📺' },
    SIGN_REST: { title: '쉼터', text: '정자랑 연못이 있어요. 앉아서 쉬고 사진도 찍어요 📸' },
    SIGN_ENTRANCE: { title: '전통발효체험관', text: '어서 와요! 장이랑 김치, 밭 이야기를 함께 배워요 👋' },
  };
  const KID_FLOORS = {
    '3F': '높은 곳에서 밭이랑 장독대를 내려다봐요 🏔️',
    '2F': '메주랑 김치 만드는 걸 배워요 🧑‍🏫',
    '1F': '맛있는 장이랑 옹기를 구경해요 🏺',
  };
  for (const [id, k] of Object.entries(KID_EDU)) if (G.data.education[id]) G.data.education[id].kid = k;
  for (const [id, k] of Object.entries(KID_QUIZ)) if (G.data.quizzes[id]) G.data.quizzes[id].kid = k;
  for (const [id, t] of Object.entries(KID_EXHIBIT)) if (G.data.exhibitInfo[id]) G.data.exhibitInfo[id].kid = t;
  for (const [id, t] of Object.entries(KID_TOOLS)) if (G.data.toolInfo[id]) G.data.toolInfo[id].kid = t;
  for (const f of G.data.hallGuide.floors) if (KID_FLOORS[f.floor]) f.kid = KID_FLOORS[f.floor];
  G.data.hallGuide.kidIntro = '체험관에는 세 층이 있어요. 층을 눌러 구경해요!';

  // [content] ---------------------------------------------------------------- phase 9 (CONTRACT §17.8): more to learn
  // 70 new learning contents and 82 quizzes in the formats above (every one with its 쉬운 모드 version), spread over
  // 발효 과학 · 장 담그기와 절기 · 옹기 · 24절기와 농사 · 김장 문화 · 지역의 장과 김치 · 도구 · 한옥 생활 · 세시풍속 · 정선 and
  // one card per new food of the 장독대. Facts are paraphrased (never copied) from 한국민족문화대백과사전 (E…),
  // 국립민속박물관 한국민속대백과사전 (F…), 농촌진흥청 농사로 (N…) and UNESCO; `sources` keeps the pages. No health claims.
  // Alcohol appears only in one grown-up knowledge card (adult: true — hidden in 쉬운 모드, no quiz).
  // Plus G.data.lectureDecks: the built-in slide decks of the 🎓 강의실 (lane lecture shows them; local mode too).
  (function () {
    const E = (id) => ({ label: '한국민족문화대백과사전', url: `https://encykorea.aks.ac.kr/Article/${id}` });
    const F = (id) => ({ label: '국립민속박물관 한국민속대백과사전', url: `https://folkency.nfm.go.kr/topic/${id}` });
    const N = (label, url) => ({ label: `농촌진흥청 농사로 · ${label}`, url });
    const UN = (label, url) => ({ label: `UNESCO · ${label}`, url });
    const UN_KIMJANG = UN('김장 문화 (2013)', 'https://ich.unesco.org/en/RL/kimjang-making-and-sharing-kimchi-in-the-republic-of-korea-00881');
    const UN_JANG = UN('장 담그기 문화 (2024)', 'https://ich.unesco.org/en/decisions/19.COM/7.B.3');
    Object.assign(G.data.educationCategories, {
      foods: { name: '발효 음식', color: '#d9894a', icon: '🍲' },
      science: { name: '발효 과학', color: '#9b86d6', icon: '🔬' },
      season: { name: '절기와 농사', color: '#5aa84f', icon: '🌞' },
      gimjang: { name: '김장 문화', color: '#e0574a', icon: '🧑‍🤝‍🧑' },
      region: { name: '지역의 맛', color: '#4f8fc0', icon: '🗺️' },
      hanok: { name: '한옥 생활', color: '#a07850', icon: '🏠' },
      folk: { name: '세시풍속', color: '#e0a030', icon: '🎎' },
      jeongseon: { name: '정선', color: '#3f9a8a', icon: '⛰️' },
    });
    const vis = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v
      : Array.isArray(v) ? { type: 'steps', items: v.map(([icon, label]) => ({ icon, label })), sep: '→' }
      : { type: 'emoji', emoji: String(v || '📖') });
    const M = (model, caption) => ({ type: 'model', model, caption });
    const kslide = ([text, v]) => (typeof v === 'number' ? { vis: v, text } : Array.isArray(v) ? { steps: v, text } : { emoji: v || '📖', text });
    const QR = () => ({ exp: 60, edu: 8 });
    const NEW = {};
    const NEWQ = {};
    /** card(id, cat, icon, title, summary, pages [[title, text, points, visual]], kid [title, summary, slides [[text, vis]]], sources, related) */
    function card(id, cat, icon, title, summary, pages, kid, sources, related) {
      NEW[id] = {
        title, cat, category: G.data.educationCategories[cat]?.name || cat, icon, summary,
        pages: pages.map(([t, text, points, v]) => ({ title: t, text, points: points || [], visual: vis(v) })),
        quizzes: [], related: related || [], sources: sources || [],
        source: (sources || []).map((s) => s.label).filter((v, i, a) => a.indexOf(v) === i).join(' · ') + ' 내용을 쉽게 풀어 쓴 요약(교육용)',
        kid: kid ? { title: kid[0], summary: kid[1], slides: kid[2].map(kslide) } : undefined,
      };
    }
    /** quiz(id, edu, question, choices, answer, explain, kid) — kid: [q, [[e,t]…], answer, hint, why] or [q, true|false, hint, why] */
    function quiz(id, edu, question, choices, answer, explain, kid) {
      const q = { edu, question, choices, answer, explain, reward: QR() };
      if (kid) q.kid = typeof kid[1] === 'boolean' ? { q: kid[0], ox: true, answer: kid[1], hint: kid[2], why: kid[3] } : { q: kid[0], choices: kid[1].map(([e, t]) => ({ e, t })), answer: kid[2], hint: kid[3], why: kid[4] };
      NEWQ[id] = q;
      if (NEW[edu]) NEW[edu].quizzes.push(id);
    }

    // ============================================================ 발효 음식 (one per new food of the 장독대)
    card('EDU_R_CHEONGGUKJANG', 'foods', '🫘', '청국장 띄우기', '삶은 콩을 볏짚과 함께 따뜻한 곳에 두면 2~3일 만에 끈끈한 실이 생겨요. 빨리 익는 장이에요.', [
      ['볏짚 속 작은 친구', '청국장은 푹 삶은 콩을 볏짚을 깐 그릇에 담아 따뜻한 아랫목(불 때는 쪽 방바닥)에 두어 만들어요. 볏짚에 사는 고초균이 콩으로 옮겨 가 빠르게 늘어나요.', ['고초균: 볏짚과 흙에 사는 작은 세균', '보통 2~3일이면 띄울 수 있어요'], [['🫘', '삶은 콩'], ['🌾', '볏짚'], ['🛏️', '아랫목'], ['🧵', '끈끈한 실']]],
      ['끈끈한 실의 정체', '청국장이 잘 뜨면 숟가락으로 떴을 때 하얀 실이 길게 늘어나요. 고초균이 콩의 성분을 바꾸면서 생기는 끈끈한 물질이에요. 된장처럼 몇 달을 기다리지 않아도 되는 빠른 장이에요.', ['된장: 몇 달 · 청국장: 며칠', '실이 많이 생기면 잘 뜬 거예요'], '🧵'],
    ], ['청국장', '볏짚 속 고초균이 따뜻한 콩에서 끈끈한 실을 만들어요 🧵', [['콩을 푹 삶아 볏짚과 함께 따뜻하게 둬요 🌾', 0], ['고초균이 쑥쑥 늘어나요', [['🫘', '콩'], ['🌾', '볏짚'], ['🧵', '실']]], ['며칠이면 다 익어요. 아주 빠른 장이에요 ⏱️', 1]]], [F('detail/8082'), N('청국장 만들기 영상', 'https://www.nongsaro.go.kr/portal/ps/psb/psbo/vodPlay.ps?mvpNo=240')], ['EDU_SCI_KOJI', 'EDU_BEAN']);
    quiz('QZ_R_CHEONGGUKJANG_1', 'EDU_R_CHEONGGUKJANG', '청국장을 띄울 때 콩과 함께 넣어 고초균을 옮겨 주는 것은?', ['볏짚', '솔잎', '한지', '숯'], 0, '볏짚에는 고초균이 살아요. 삶은 콩을 볏짚과 함께 따뜻하게 두면 균이 옮겨 가 청국장이 떠요.', ['청국장에는 무엇을 넣어 띄울까요?', [['🌾', '볏짚'], ['🍃', '솔잎'], ['🧊', '얼음']], 0, '벼를 거두고 남은 줄기예요 🌾', '맞아요! 볏짚 속 고초균이 콩을 바꿔요.']);
    quiz('QZ_R_CHEONGGUKJANG_2', 'EDU_R_CHEONGGUKJANG', '청국장은 보통 얼마 동안 띄울까요?', ['2~3일', '2~3달', '2~3년', '2~3시간'], 0, '따뜻한 곳에서 2~3일이면 끈끈한 실이 생겨요. 몇 달 익히는 된장보다 훨씬 빨라요.', ['청국장은 며칠이면 될까요? 몇 년이 걸려요!', false, '아주 빠른 장이에요 ⏱️', '아니에요! 2~3일이면 돼요.']);

    card('EDU_R_MAKJANG', 'foods', '🟫', '막장 — 강원도의 빠른 장', '메주를 가루로 빻아 보리 같은 곡물과 소금물을 섞어, 오래 기다리지 않고 먹는 장이에요.', [
      ['막장은 어떤 장일까요?', '막장은 메줏가루에 보리·밀·쌀 같은 곡물을 섞고 소금물로 되기를 맞춰 담가요. 간장을 뜨지 않고 바로 된장처럼 먹어서, 된장보다 빨리 익고 단맛이 더 나요.', ['메줏가루: 메주를 곱게 빻은 가루', '강원도에서 즐겨 담가요'], [['🫘', '메줏가루'], ['🌾', '보리'], ['🧂', '소금물'], ['🟫', '막장']]],
      ['곡물이 들어가면 왜 빨리 익을까요?', '곡물의 녹말은 미생물과 효소가 먹기 좋은 먹이예요. 먹이가 넉넉하니 발효가 빨리 일어나고 단맛도 생겨요. 강원도에서는 보리쌀을 쪄서 메줏가루와 버무린 가루장도 담갔어요.', ['녹말 → 단맛', '가루장: 보리쌀 + 메줏가루 + 식힌 소금물'], '🌾'],
    ], ['막장', '보리를 넣은 막장은 된장보다 빨리 익고 달큰해요 🟫', [['메줏가루랑 보리를 섞어요 🌾', 0], ['곡물은 미생물의 맛있는 먹이예요', [['🌾', '보리'], ['🦠', '미생물'], ['🍯', '단맛']]], ['강원도 사람들이 즐겨 담갔어요 ⛰️', 1]]], [F('detail/7554'), E('E0016941')], ['EDU_DOENJANG', 'EDU_REGION_JANG']);
    quiz('QZ_R_MAKJANG_1', 'EDU_R_MAKJANG', '막장이 된장보다 빨리 익는 까닭으로 알맞은 것은?', ['보리 같은 곡물이 미생물의 먹이가 되어서', '소금을 넣지 않아서', '냉장고에 넣어서', '고춧가루를 많이 넣어서'], 0, '곡물의 녹말이 미생물과 효소의 먹이가 되어 발효가 빨리 일어나고 단맛도 생겨요.', ['막장에 넣는 곡식은 무엇일까요?', [['🌾', '보리'], ['🍬', '사탕'], ['🧀', '치즈']], 0, '밭에서 자라는 곡식이에요 🌾', '맞아요! 보리를 넣어요.']);

    card('EDU_R_BAEKKIMCHI', 'foods', '🥬', '백김치 — 하얀 김치', '고춧가루를 넣지 않고 배·밤·마늘로 소를 만들어 국물과 함께 시원하게 익혀요.', [
      ['맵지 않은 김치', '백김치는 고추를 쓰지 않거나 아주 조금만 써서 하얗게 담가요. 소(속에 넣는 재료)는 마늘·생강·미나리·청각에 배·밤·잣 같은 것을 넣기도 해요.', ['소: 김치 속에 넣는 양념과 재료', '매운 것을 못 먹는 사람도 즐겨요'], [['🥬', '절인 배추'], ['🍐', '배·밤'], ['💧', '국물'], ['❄️', '서늘하게']]],
      ['국물이 새콤해지는 까닭', '심심한 소금물을 넉넉히 부으면 젖산균이 국물 속에서 고루 자라요. 젖산균이 채소의 단맛을 신맛으로 바꿔서 시원하고 새콤한 국물이 돼요. 동치미와 쓰임이 비슷해요.', ['젖산균이 단맛 → 신맛', '동치미와 비슷한 물김치'], M('kimchi', '익어 가는 김치')],
    ], ['백김치', '빨갛지 않은 하얀 김치예요. 국물이 시원해요 🥬', [['고춧가루 없이 하얗게 담가요 🤍', 0], ['배랑 밤을 넣어 달큰해요', [['🥬', '배추'], ['🍐', '배'], ['🌰', '밤']]], ['젖산균이 국물을 새콤하게 해요 🦠', 1]]], [F('KR/topic/detail/7654'), E('E0022013')], ['EDU_KIMCHI', 'EDU_SCI_LACTIC']);
    quiz('QZ_R_BAEKKIMCHI_1', 'EDU_R_BAEKKIMCHI', '백김치의 가장 큰 특징은?', ['고춧가루를 쓰지 않거나 아주 조금 써서 하얗다', '생선만으로 만든다', '삶아서 만든다', '설탕으로만 맛을 낸다'], 0, '백김치는 고추를 쓰지 않아 하얗고 맵지 않아요. 배·밤·마늘 등으로 소를 만들어요.', ['하얀 김치의 이름은 무엇일까요?', [['🤍', '백김치'], ['🟥', '깍두기'], ['🧅', '파김치']], 0, '하얀 색을 뜻하는 이름이에요 🤍', '맞아요! 백김치예요.']);

    card('EDU_R_KKAKDUGI', 'foods', '🟥', '깍두기', '무를 주사위처럼 네모나게 썰어 절이고 고춧가루와 젓갈로 버무린 김치예요.', [
      ['네모난 무 김치', '깍두기는 무를 2~3cm 크기의 네모로 썰어 소금에 절인 뒤, 고춧가루로 먼저 빨갛게 물들이고 파·마늘·생강·새우젓을 넣어 버무려요.', ['깍둑썰기: 네모반듯하게 써는 것', '새우젓으로 감칠맛을 더해요'], [['🔪', '깍둑썰기'], ['🧂', '절이기'], ['🌶️', '물들이기'], ['🦐', '새우젓']]],
      ['무가 김치가 되기까지', '무에서 나온 달고 시원한 즙이 젖산균의 먹이가 돼요. 실온에서는 하루쯤, 서늘한 곳에서는 며칠이면 새콤하게 익어요. 너무 따뜻하면 금방 시어져요.', ['따뜻하면 빨리, 서늘하면 천천히', '무의 단맛 → 젖산균 → 새콤한 맛'], '🥕'],
    ], ['깍두기', '네모난 무가 아삭아삭 김치가 돼요 🟥', [['무를 네모나게 썰어요 🔪', 0], ['빨간 양념에 버무려요', [['🥕', '무'], ['🌶️', '고춧가루'], ['🦐', '새우젓']]], ['며칠 지나면 새콤해져요 😋', 1]]], [E('E0011225'), F('깍두기')], ['EDU_KIMCHI', 'EDU_REGION_JEOT']);
    quiz('QZ_R_KKAKDUGI_1', 'EDU_R_KKAKDUGI', '깍두기를 만들 때 무를 써는 모양은?', ['주사위 같은 네모', '길고 가는 채', '동그란 통째', '얇은 반달'], 0, '깍두기는 무를 2~3cm 크기의 네모로 써는 깍둑썰기를 해요.', ['깍두기는 무를 어떻게 썰까요?', [['🎲', '네모나게'], ['🍝', '국수처럼 길게'], ['🌙', '반달처럼']], 0, '주사위를 떠올려 봐요 🎲', '맞아요! 네모나게 썰어요.']);

    card('EDU_R_DONGCHIMI', 'foods', '🥣', '동치미 — 겨울 물김치', '작은 통무를 소금물에 담가 겨울 동안 익혀요. 톡 쏘는 시원한 국물이 특징이에요.', [
      ['겨울에 담그는 김치', '동치미는 옛 책에 겨울 김치라는 뜻의 이름으로 적혀 있어요. 통무를 소금에 굴려 독에 넣고 생강·파·청각·풋고추와 함께 심심한 소금물을 부어요.', ['청각: 바다에서 나는 사슴뿔 모양 해조류', '서늘한 곳에서 2~3주 익혀요'], [['🥕', '통무'], ['🧂', '소금'], ['🏺', '독'], ['💧', '소금물']]],
      ['톡 쏘는 맛의 비밀', '젖산균이 신맛을 만들면서 탄산가스도 만들어요. 이 가스가 국물에 녹아 톡 쏘는 시원한 맛을 내요. 그런데 따뜻하면 가스가 빠져나가서 시원한 맛이 줄어요.', ['탄산가스: 사이다의 톡 쏘는 기포와 같은 기체', '서늘하게 두어야 시원해요'], '🫧'],
    ], ['동치미', '톡 쏘는 시원한 겨울 물김치예요 🥣', [['통무를 소금물에 담가요 🥕', 0], ['젖산균이 톡 쏘는 기포를 만들어요', [['🦠', '젖산균'], ['🫧', '기포'], ['😋', '시원해요']]], ['서늘해야 톡 쏘는 맛이 남아요 ❄️', 1]]], [E('E0016831'), F('detail/7519')], ['EDU_SCI_LACTIC', 'EDU_GIMJANG_DAY']);
    quiz('QZ_R_DONGCHIMI_1', 'EDU_R_DONGCHIMI', '동치미 국물이 톡 쏘는 까닭은?', ['젖산균이 만든 탄산가스가 녹아 있어서', '고춧가루를 많이 넣어서', '얼음을 넣어서', '설탕을 넣어서'], 0, '젖산균이 발효하며 만든 탄산가스가 국물에 녹아 톡 쏘는 맛이 나요. 따뜻하면 가스가 빠져요.', ['동치미는 따뜻한 곳에 두어야 더 시원할까요?', false, '톡 쏘는 기포는 따뜻하면 빠져나가요 🫧', '아니에요! 서늘해야 시원해요.']);
    quiz('QZ_R_DONGCHIMI_2', 'EDU_R_DONGCHIMI', '동치미를 담글 때 무는 주로 어떻게 넣을까요?', ['작은 무를 통째로', '가루로 빻아서', '볶아서', '말려서 가루로'], 0, '동치미는 작고 단단한 무를 통째로 소금에 굴려 독에 넣어요.', ['동치미에는 무를 어떻게 넣을까요?', [['🥕', '통째로'], ['🧂', '가루로'], ['🔥', '구워서']], 0, '무를 자르지 않아요 🥕', '맞아요! 통째로 넣어요.']);

    card('EDU_R_CHONGGAK', 'foods', '🥕', '총각김치', '손가락만 한 총각무를 무청째 담가요. 무와 무청이 함께 맛을 내요.', [
      ['이름의 까닭', '뿔 모양의 작은 무에 잎(무청)이 달린 모습이 옛날 총각의 땋은 머리를 닮아서 총각김치라는 이름이 붙었다고 알려져 있어요.', ['무청: 무의 잎과 줄기', '김장 때 함께 담그는 김치'], '🥕'],
      ['담그는 순서', '잔뿌리를 떼고 무청째 씻어 소금에 절여 숨을 죽여요. 고춧가루·마늘·젓갈 양념에 버무려 두세 개씩 묶어 독에 담고 서늘하게 익혀요.', ['숨을 죽이다: 소금에 절여 부드럽게 만들다'], [['🥕', '다듬기'], ['🧂', '절이기'], ['🌶️', '버무리기'], ['🏺', '익히기']]],
    ], ['총각김치', '총각머리를 닮은 작은 무로 담가요 🥕', [['무청이 달린 작은 무예요', 0], ['절이고 양념에 버무려요', [['🥕', '무'], ['🧂', '소금'], ['🌶️', '양념']]], ['독에 담아 익혀요 🏺', 1]]], [F('총각김치'), F('김장')], ['EDU_KIMCHI', 'EDU_GIMJANG_DAY']);
    quiz('QZ_R_CHONGGAK_1', 'EDU_R_CHONGGAK', '총각김치라는 이름은 무엇을 닮아 붙었다고 알려져 있을까요?', ['무청 달린 무가 총각의 땋은 머리를 닮아서', '총각들만 먹어서', '만든 사람 이름이라서', '총각무가 아주 커서'], 0, '뿔 모양 무에 무청이 달린 모습이 옛날 총각의 머리 모양을 닮았다고 해요.', ['총각김치는 무의 잎까지 함께 담가요. 맞을까요?', true, '초록 잎을 무청이라고 해요 🌿', '맞아요! 무청째 담가요.']);

    card('EDU_R_SOBAGI', 'foods', '🥒', '오이소박이', '절인 오이에 칼집을 내고 파·마늘·고춧가루 소를 채운 여름 김치예요.', [
      ['소를 박은 김치', '소박이는 오이·가지·고추·무 같은 채소에 소를 채워 넣은 김치예요. 그중 가장 대표적인 것이 오이소박이예요. 오이에 서너 개 칼집을 내고 소를 꼭꼭 채워요.', ['소박이: 소를 박아 넣은 김치'], [['🥒', '절인 오이'], ['🔪', '칼집'], ['🧅', '소'], ['🖐️', '채우기']]],
      ['여름 김치는 빨리 익어요', '날이 더우면 젖산균이 빨리 늘어나서 김치가 금방 새콤해져요. 그래서 여름 김치는 조금씩 담가 시원한 곳에 두고 먹었어요.', ['더우면 빨리, 시원하면 천천히 익어요'], '☀️'],
    ], ['오이소박이', '오이 속에 양념을 쏙쏙 채워요 🥒', [['오이에 칼집을 내요 🔪', 0], ['소를 꼭꼭 채워요', [['🥒', '오이'], ['🧅', '쪽파'], ['🌶️', '고춧가루']]], ['여름엔 빨리 익어요. 시원하게 둬요 ❄️', 1]]], [E('E0038476'), F('kr/topic/detail/7767')], ['EDU_KIMCHI', 'EDU_SEASON_SUMMER']);
    quiz('QZ_R_SOBAGI_1', 'EDU_R_SOBAGI', '‘소박이’ 김치의 뜻으로 알맞은 것은?', ['채소에 소를 채워 넣은 김치', '물을 많이 부은 김치', '말린 채소 김치', '생선을 넣은 김치'], 0, '소박이는 오이·가지·무 같은 채소에 칼집을 내고 소를 채워 넣은 김치예요.', ['오이소박이는 오이 속에 무엇을 넣을까요?', [['🌶️', '양념 소'], ['🍫', '초콜릿'], ['🧊', '얼음']], 0, '파·마늘·고춧가루로 만들어요 🌶️', '맞아요! 양념 소를 넣어요.']);

    card('EDU_R_GATKIMCHI', 'foods', '🍃', '갓김치', '톡 쏘는 맛이 있는 갓으로 담근 김치예요. 여수 돌산의 갓김치가 이름났어요.', [
      ['돌산 갓', '전라남도 여수의 돌산은 따뜻한 바닷바람이 부는 곳이라 갓이 연하고 맛있게 자라요. 이 갓에 젓갈과 고춧가루 양념을 버무려 갓김치를 담가요.', ['갓: 겨자 같은 톡 쏘는 맛의 잎채소', '해양성 기후: 바다 때문에 덜 춥고 덜 더운 날씨'], '🍃'],
      ['익으면 순해져요', '갓의 톡 쏘는 맛은 익어 가면서 부드러워지고, 젖산균이 새콤한 맛을 더해요. 푹 익혀 먹는 사람도 많아요.', ['톡 쏘는 맛 → 부드러운 맛'], [['🍃', '갓'], ['🧂', '절이기'], ['🌶️', '양념'], ['⏳', '푹 익히기']]],
    ], ['갓김치', '코끝이 찡한 갓으로 담가요 🍃', [['바닷바람 부는 여수 돌산에서 자란 갓이에요 🌊', 0], ['양념에 버무려 익혀요', [['🍃', '갓'], ['🌶️', '양념'], ['🏺', '독']]], ['익으면 톡 쏘는 맛이 부드러워져요', 1]]], [E('E0080025'), E('E0036392')], ['EDU_REGION_KIMCHI']);
    quiz('QZ_R_GATKIMCHI_1', 'EDU_R_GATKIMCHI', '갓김치로 이름난 곳은?', ['전라남도 여수 돌산', '강원도 정선', '제주도 한라산', '서울 남산'], 0, '여수 돌산은 따뜻한 해양성 기후라 갓이 연하고 맛있게 자라 갓김치로 유명해요.', ['갓김치는 어떤 맛이 있을까요?', [['👃', '코끝이 찡한 맛'], ['🍬', '사탕 맛'], ['🧊', '아무 맛 없음']], 0, '겨자처럼 톡 쏘아요 👃', '맞아요! 톡 쏘는 맛이에요.']);

    card('EDU_R_PAKIMCHI', 'foods', '🧅', '파김치', '쪽파를 젓국에 절였다가 고춧가루·마늘·생강으로 버무려 돌돌 말아 담가요.', [
      ['젓국으로 버무려요', '파김치는 절인 쪽파에 다진 마늘·생강을 넣고 고춧가루로 색을 낸 뒤 젓국(젓갈에서 나온 국물)으로 간을 해요. 파가 주재료라서 양념에는 파를 넣지 않아요.', ['젓국: 젓갈을 삭혀 나온 맑은 국물'], [['🧅', '쪽파'], ['🐟', '젓국'], ['🌶️', '고춧가루'], ['🌀', '돌돌 말기']]],
      ['돌돌 말아 담는 까닭', '몇 가닥씩 돌돌 말아 담으면 꺼내 먹기 좋고 양념이 고루 배어요. 익으면 파의 매운맛이 순해지고 감칠맛이 돌아요.', ['매운맛 → 순한 맛'], '🌀'],
    ], ['파김치', '쪽파를 돌돌 말아 담가요 🧅', [['쪽파에 빨간 양념을 발라요', 0], ['돌돌 말아요', [['🧅', '쪽파'], ['🌀', '돌돌'], ['🏺', '담기']]], ['익으면 맛이 순해져요 😋', 1]]], [E('E0059544'), F('detail/8128')], ['EDU_KIMCHI']);
    quiz('QZ_R_PAKIMCHI_1', 'EDU_R_PAKIMCHI', '파김치의 간을 맞출 때 주로 쓰는 것은?', ['젓국', '식초', '꿀', '우유'], 0, '파김치는 젓갈에서 나온 국물인 젓국으로 간을 맞추고 버무려요.', ['파김치는 쪽파로 만들어요. 맞을까요?', true, '가늘고 연한 파예요 🧅', '맞아요! 쪽파로 담가요.']);

    card('EDU_R_YEOLMU', 'foods', '🌿', '열무김치', '여름에 자라는 어린 무로 담그는 시원한 김치예요. 살살 다뤄야 풋내가 나지 않아요.', [
      ['여름의 김치', '열무는 잎과 줄기가 연한 어린 무예요. 살살 뒤집으며 절이고, 밀가루나 감자로 쑨 풀국을 넣어 시원하게 담가요. 강원도에서는 감자를 넣은 열무김치도 담가요.', ['풀국: 곡물 가루를 물에 넣어 끓인 묽은 죽', '세게 주무르면 풋내가 나요'], [['🌿', '열무'], ['🧂', '살살 절이기'], ['🥣', '풀국'], ['💧', '담그기']]],
      ['풀국은 무슨 일을 할까요?', '풀국의 녹말은 젖산균의 먹이가 돼요. 먹이가 고루 퍼져 있어 김치가 고르게 익고 국물 맛이 부드러워져요.', ['녹말 → 젖산균의 먹이'], '🥣'],
    ], ['열무김치', '여름에 먹는 시원한 열무김치예요 🌿', [['어린 무 열무로 담가요', 0], ['풀국을 넣어요', [['🌿', '열무'], ['🥣', '풀국'], ['🦠', '젖산균']]], ['살살 다뤄야 맛있어요 🤲', 1]]], [F('김장'), F('무청김치')], ['EDU_SEASON_SUMMER', 'EDU_REGION_KIMCHI']);
    quiz('QZ_R_YEOLMU_1', 'EDU_R_YEOLMU', '열무김치에 풀국을 넣는 까닭으로 알맞은 것은?', ['녹말이 젖산균의 먹이가 되어 고르게 익어서', '색을 하얗게 하려고', '짠맛을 없애려고', '얼지 않게 하려고'], 0, '풀국의 녹말이 젖산균의 먹이가 되어 김치가 고르게 익고 국물이 부드러워져요.', ['열무는 세게 주물러야 맛있을까요?', false, '풋내가 날 수 있어요 🌿', '아니에요! 살살 다뤄요.']);

    card('EDU_R_NABAK', 'foods', '🍲', '나박김치', '무와 배추를 얇고 네모나게 썰어 고춧가루 물을 곱게 들인 국물에 담가요.', [
      ['나박나박 썰어요', '‘나박’은 무를 얇고 네모지게 써는 모양을 말해요. 무와 배추를 나박하게 썰어 살짝 절인 뒤, 고춧가루를 베주머니에 넣어 우린 고운 물을 부어요.', ['베주머니: 삼베로 만든 작은 자루'], [['🔪', '나박 썰기'], ['🧂', '살짝 절이기'], ['🌶️', '고운 물'], ['💧', '국물']]],
      ['빨리 익는 물김치', '국물이 많아 젖산균이 고루 퍼지고 하루 이틀이면 새콤해져요. 봄과 명절 상에 자주 올랐어요.', ['하루 이틀이면 먹어요'], '🍲'],
    ], ['나박김치', '납작하게 썬 무로 담근 물김치예요 🍲', [['무를 얇고 네모나게 썰어요', 0], ['분홍빛 국물을 부어요', [['🥕', '무'], ['🥬', '배추'], ['💧', '국물']]], ['하루만 지나도 새콤해요 😋', 1]]], [F('detail/7592')], ['EDU_KIMCHI', 'EDU_FOLK_SEOLLAL']);
    quiz('QZ_R_NABAK_1', 'EDU_R_NABAK', '나박김치 국물을 곱게 물들일 때 고춧가루를 어떻게 쓸까요?', ['베주머니에 넣어 우린다', '통고추를 그대로 넣는다', '쓰지 않는다', '기름에 볶아 넣는다'], 0, '고춧가루를 베주머니에 넣어 우리면 가루가 떠다니지 않는 고운 분홍빛 국물이 돼요.', ['나박김치는 국물이 많은 물김치예요. 맞을까요?', true, '국물을 넉넉히 부어요 💧', '맞아요! 물김치예요.']);

    card('EDU_R_JEOTGAL', 'foods', '🦐', '젓갈 — 새우젓과 멸치젓', '새우나 멸치를 소금에 절여 오래 삭힌 음식이에요. 김치의 감칠맛을 내요.', [
      ['잡은 때에 따라 이름이 달라요', '새우젓은 새우와 소금을 10:3이나 10:4쯤으로 섞어 담가요. 봄에 잡으면 춘젓, 5월은 오젓, 6월은 육젓, 가을은 추젓이라고 불러요. 그중 육젓을 으뜸으로 쳐요.', ['오젓·육젓·추젓: 담근 때에 따른 이름'], [['🦐', '새우'], ['🧂', '소금'], ['🏺', '항아리'], ['⏳', '삭히기']]],
      ['소금 속에서 무슨 일이?', '많은 소금이 음식을 상하게 하는 균을 막는 동안, 생선 속에 있던 효소가 살을 천천히 녹여 깊은 감칠맛을 만들어요. 그래서 젓갈은 김치 양념에 꼭 들어가요.', ['효소: 성분을 잘게 자르는 단백질', '감칠맛: 입맛을 당기는 깊은 맛'], '🐟'],
    ], ['젓갈', '작은 새우랑 멸치를 소금에 절여 삭혀요 🦐', [['새우와 소금을 섞어요 🧂', 0], ['오래오래 기다려요', [['🦐', '새우'], ['🧂', '소금'], ['⏳', '두세 달']]], ['김치를 맛있게 하는 양념이 돼요 😋', 1]]], [F('새우젓'), N('김장 큐레이션', 'https://www.nongsaro.go.kr/portal/ps/psv/psvr/psvre/curationDtl.ps?menuId=PS03352&srchCurationNo=1080')], ['EDU_REGION_JEOT', 'EDU_SCI_SALT']);
    quiz('QZ_R_JEOTGAL_1', 'EDU_R_JEOTGAL', '음력 6월에 잡은 새우로 담근 새우젓을 무엇이라고 할까요?', ['육젓', '추젓', '춘젓', '동젓'], 0, '담근 때에 따라 오젓(5월)·육젓(6월)·추젓(가을)이라 부르고, 육젓을 으뜸으로 쳐요.', ['젓갈을 담글 때 꼭 필요한 것은?', [['🧂', '소금'], ['🍬', '설탕'], ['🧈', '버터']], 0, '짭짤한 하얀 알갱이예요 🧂', '맞아요! 소금이 꼭 필요해요.']);
    quiz('QZ_R_JEOTGAL_2', 'EDU_R_JEOTGAL', '젓갈 속에서 생선 살을 녹여 감칠맛을 만드는 것은?', ['생선 속 효소', '햇빛', '얼음', '바람'], 0, '소금이 상하게 하는 균을 막는 동안 생선 속 효소가 살을 천천히 나누어 감칠맛을 만들어요.', null);

    card('EDU_R_SIKHAE', 'foods', '🐠', '가자미식해', '가자미에 조밥·엿기름·무채·고춧가루를 버무려 삭힌 함경도의 음식이에요.', [
      ['식해는 어떤 음식일까요?', '식해는 생선에 곡물 밥과 엿기름을 넣어 삭힌 음식이에요. 함경도에서는 꾸덕하게 말린 가자미에 조밥(좁쌀 밥)과 엿기름·무채·고춧가루를 버무려 서늘한 곳에서 1~2주 삭혀요.', ['조밥: 좁쌀로 지은 밥', '삭히다: 오래 두어 맛이 들게 하다'], [['🐠', '가자미'], ['🟡', '조밥'], ['🌱', '엿기름'], ['🏺', '삭히기']]],
      ['식해와 식혜는 달라요', '이름이 비슷하지만 식해는 생선이 들어간 반찬이고, 식혜는 밥알이 동동 뜨는 단 음료예요. 엿기름이 밥을 달게 하고 젖산균이 새콤하게 하는 과정은 서로 닮았어요.', ['식해: 생선 반찬 · 식혜: 단 음료'], '🐠'],
    ], ['가자미식해', '생선과 조밥을 함께 삭혀요 🐠', [['가자미에 조밥이랑 엿기름을 섞어요', 0], ['서늘한 곳에서 삭혀요', [['🐠', '가자미'], ['🟡', '조밥'], ['❄️', '서늘하게']]], ['식해와 식혜는 달라요! 식혜는 단 음료예요 🥛', 1]]], [N('가자미식해', 'https://www.nongsaro.go.kr/portal/ps/psr/psrc/areaCkRyDtl.ps?menuId=PS03934&cntntsNo=91927'), E('E0062997')], ['EDU_REGION_SIKHAE', 'EDU_R_SIKHYE']);
    quiz('QZ_R_SIKHAE_1', 'EDU_R_SIKHAE', '가자미식해에 들어가는 곡물 밥은?', ['조밥', '보리빵', '떡국떡', '국수'], 0, '함경도의 가자미식해에는 좁쌀로 지은 조밥과 엿기름이 들어가요.', ['식해와 식혜는 같은 음식일까요?', false, '하나는 생선 반찬, 하나는 단 음료예요 🐠🥛', '아니에요! 서로 다른 음식이에요.']);

    card('EDU_R_VINEGAR', 'foods', '🍶', '감식초와 현미식초', '과일이나 곡물의 단맛이 먼저 술맛이 되고, 다시 초산균이 새콤한 식초로 바꿔요.', [
      ['두 번의 발효', '식초는 발효가 두 번 일어나요. 먼저 효모가 단맛을 알코올로 바꾸고, 그다음 공기를 좋아하는 초산균이 알코올을 초산으로 바꿔요. 홍시로 담그면 감식초, 현미 밑술로 만들면 현미식초예요.', ['밑술: 식초를 만들기 위해 먼저 빚는 술', '초산: 식초의 신맛을 내는 성분'], [['🟠', '홍시·현미'], ['🍃', '효모'], ['🦠', '초산균'], ['🍶', '식초']]],
      ['뚜껑 대신 천을 덮어요', '초산균은 공기가 있어야 일해요. 그래서 식초 항아리는 꼭 막지 않고 천으로 덮어 바람이 통하게 해요. 따뜻한 25~30℃에서 한 달 반쯤 지나면 걸러서 다시 익혀요.', ['25~30℃에서 45일쯤 (농사로 자료)'], M('vinegar', '식초 항아리')],
    ], ['식초', '홍시가 새콤한 식초로 변신해요 🍶', [['단맛이 먼저 술맛이 돼요 🍃', 0], ['초산균이 새콤하게 바꿔요', [['🟠', '홍시'], ['🦠', '초산균'], ['🍶', '식초']]], ['초산균은 공기를 좋아해서 천을 덮어요 🌬️', 1]]], [N('식초 발효', 'https://www.nongsaro.go.kr/portal/ps/psv/psvr/psvrc/rdaInterDtl.ps?menuId=PS00063&cntntsNo=34315'), F('detail/7823')], ['EDU_SCI_ACETIC', 'EDU_FERMENT']);
    quiz('QZ_R_VINEGAR_1', 'EDU_R_VINEGAR', '식초 항아리를 꼭 막지 않고 천으로 덮는 까닭은?', ['초산균은 공기가 있어야 일해서', '벌레가 좋아해서', '빨리 증발시키려고', '햇빛을 막으려고'], 0, '초산균은 공기(산소)를 좋아하는 미생물이에요. 천으로 덮어 공기가 통하게 해요.', ['식초를 새콤하게 만드는 미생물은?', [['🦠', '초산균'], ['🐟', '물고기'], ['🌸', '꽃']], 0, '이름에 ‘초’가 들어가요 🍶', '맞아요! 초산균이에요.']);
    quiz('QZ_R_VINEGAR_2', 'EDU_R_VINEGAR', '감식초가 만들어지는 순서로 알맞은 것은?', ['단맛 → 알코올 → 초산', '초산 → 알코올 → 단맛', '소금 → 단맛 → 초산', '물 → 얼음 → 초산'], 0, '효모가 감의 단맛을 알코올로, 초산균이 알코올을 초산으로 차례로 바꿔요.', null);

    card('EDU_R_NURUK', 'foods', '🟫', '누룩 디디기', '거칠게 빻은 밀을 반죽해 틀에 넣고 발로 디딘 뒤 따뜻하게 띄워 곰팡이와 효모를 키워요.', [
      ['누룩은 무엇일까요?', '누룩은 밀 같은 곡물을 반죽해 단단히 뭉친 덩어리에 곰팡이와 효모가 자리 잡게 한 거예요. 곰팡이는 녹말을 단맛으로 바꾸는 효소를 만들고, 효모는 발효에 쓰여요.', ['디디다: 발로 꼭꼭 밟아 단단하게 하다'], [['🌾', '밀 빻기'], ['💧', '반죽'], ['🦶', '디디기'], ['🌾', '띄우기']]],
      ['누룩은 어디에 쓸까요?', '누룩은 식초의 밑술을 빚거나, 증편 같은 떡을 부풀리는 술밑을 만들 때 써요. 볏짚에 싸서 따뜻하고 축축한 곳에서 2~3주 띄워요.', ['발효의 씨앗 같은 재료'], '🟫'],
    ], ['누룩', '밀 반죽을 발로 꾹꾹 밟아 띄워요 🦶', [['밀을 빻아 반죽해요 🌾', 0], ['발로 꼭꼭 밟아요', [['🌾', '밀'], ['🦶', '꾹꾹'], ['🟫', '누룩']]], ['곰팡이와 효모가 자리 잡아요 🦠', 1]]], [F('누룩'), F('detail/7806')], ['EDU_SCI_ENZYME', 'EDU_R_JEUNGPYEON']);
    quiz('QZ_R_NURUK_1', 'EDU_R_NURUK', '누룩을 만들 때 반죽을 틀에 넣고 하는 일은?', ['발로 단단히 디딘다', '물에 담가 녹인다', '불에 태운다', '얼린다'], 0, '누룩은 반죽을 틀에 넣고 발로 꼭꼭 밟아(디뎌) 단단하게 만든 뒤 띄워요.', ['누룩은 무엇으로 만들까요?', [['🌾', '밀'], ['🐟', '생선'], ['🍎', '사과']], 0, '빵을 만드는 곡식이에요 🌾', '맞아요! 밀로 만들어요.']);

    card('EDU_R_JEUNGPYEON', 'foods', '🍡', '증편 — 부풀린 여름 떡', '멥쌀가루를 술밑으로 반죽해 따뜻하게 부풀린 뒤 쪄 내는 새콤한 떡이에요.', [
      ['폭신폭신한 떡', '증편은 멥쌀가루에 술밑(효모가 든 술)을 넣고 묽게 반죽해 따뜻한 곳에 두어요. 효모가 내뿜는 가스가 반죽을 폭신하게 부풀리면 틀에 부어 쪄요. 기주떡이라고도 해요.', ['술밑: 발효를 일으키는 밑재료', '찐 뒤에는 알코올이 거의 남지 않아요'], [['🍚', '쌀가루'], ['🟫', '술밑'], ['🫧', '부풀리기'], ['♨️', '찌기']]],
      ['여름에도 잘 쉬지 않아요', '발효로 생긴 새콤한 맛 덕분에 더운 여름에도 쉽게 상하지 않아 여름 떡으로 즐겨 먹었어요.', ['쉬다: 음식이 상해 시큼해지다'], '🍡'],
    ], ['증편', '효모가 쌀 반죽을 폭신하게 부풀려요 🫧', [['쌀가루 반죽을 따뜻하게 둬요', 0], ['보글보글 부풀어요', [['🍚', '쌀가루'], ['🫧', '부풀기'], ['♨️', '찌기']]], ['여름에도 잘 상하지 않는 떡이에요 ☀️', 1]]], [F('detail/8052'), E('E0008438')], ['EDU_SCI_YEAST', 'EDU_FOLK_DANO']);
    quiz('QZ_R_JEUNGPYEON_1', 'EDU_R_JEUNGPYEON', '증편 반죽을 부풀리는 것은?', ['효모가 내뿜는 가스', '얼음', '소금', '바람'], 0, '술밑 속 효모가 가스를 내뿜어 반죽이 폭신하게 부풀어요.', ['증편은 여름에 먹는 떡이에요. 맞을까요?', true, '더운 날에도 잘 상하지 않아요 ☀️', '맞아요! 여름 떡이에요.']);

    card('EDU_R_SIKHYE', 'foods', '🥛', '식혜와 조청 — 효소의 단맛', '엿기름 속 효소가 밥의 녹말을 잘게 잘라 단맛을 만들어요. 졸이면 조청과 엿이 돼요.', [
      ['미생물이 아니라 효소가 일해요', '엿기름은 보리에 싹을 틔워 말린 거예요. 엿기름을 물에 주물러 거른 웃물을 밥에 붓고 60~70℃쯤으로 4~5시간 두면 밥알이 동동 떠요. 효소가 녹말을 단맛으로 바꾸는 이 일을 ‘당화’라고 해요.', ['당화: 녹말이 단맛 나는 당으로 바뀌는 것', '미생물이 아니라 효소가 일해요'], [['🌱', '엿기름물'], ['🍚', '밥'], ['♨️', '따뜻하게'], ['🥛', '밥알 동동']]],
      ['조청과 엿', '삭힌 단물을 삼베 주머니로 짜서 약한 불에 오래 졸이면 꿀처럼 걸쭉한 조청이 되고, 더 고면 단단한 엿이 돼요. 오래 졸일수록 색이 짙어지는데 당이 열을 받아 생기는 변화예요. 강원도에서는 옥수수로도 엿을 고았어요.', ['고다: 오래 끓여 진하게 만들다'], '🍯'],
    ], ['식혜와 조청', '엿기름 속 효소가 밥을 달콤하게 해요 🥛', [['엿기름물을 밥에 부어요 🌱', 0], ['따뜻하게 두면 밥알이 동동 떠요', [['🍚', '밥'], ['🌱', '엿기름'], ['🥛', '식혜']]], ['오래 졸이면 꿀 같은 조청이 돼요 🍯', 1]]], [E('E0032592'), F('식혜'), F('detail/7889'), E('E0001283')], ['EDU_SCI_ENZYME', 'EDU_FOLK_SEOLLAL']);
    quiz('QZ_R_SIKHYE_1', 'EDU_R_SIKHYE', '식혜를 달게 만드는 것은 무엇일까요?', ['엿기름 속 효소', '젖산균', '초산균', '소금'], 0, '식혜는 미생물이 아니라 엿기름 속 효소가 밥의 녹말을 단맛으로 바꿔요. 이것을 당화라고 해요.', ['식혜가 다 되면 밥알이 어떻게 될까요?', [['🥛', '동동 떠요'], ['🪨', '돌처럼 굳어요'], ['🔥', '타요']], 0, '물 위로 올라와요 🥛', '맞아요! 밥알이 동동 떠요.']);
    quiz('QZ_R_SIKHYE_2', 'EDU_R_SIKHYE', '엿기름은 무엇으로 만들까요?', ['보리에 싹을 틔워 말린 것', '콩을 삶아 띄운 것', '밀을 발로 디딘 것', '쌀을 볶은 것'], 0, '엿기름은 보리를 물에 불려 싹을 틔운 뒤 말려 빻은 가루예요.', null);

    card('EDU_R_JANGAJJI', 'foods', '🫙', '장아찌', '채소를 간장·된장·고추장에 넣어 짭짤하게 절인 밑반찬이에요. 오래 두고 먹어요.', [
      ['장에 박아 두는 반찬', '장아찌는 오이·무·마늘·고추·깻잎 같은 채소를 간장·된장·고추장에 넣어 맛을 들인 반찬이에요. 오이는 절여 물기를 빼고 말려 고추장에 박고, 무는 된장에 박기도 해요.', ['밑반찬: 오래 두고 먹는 반찬', '박다: 장 속에 묻어 두다'], [['🥕', '썰고 말리기'], ['🟤', '장에 박기'], ['⏳', '기다리기'], ['🍽️', '꺼내기']]],
      ['짠맛이 지켜 줘요', '장의 짠맛이 채소의 물기를 빼고 상하지 않게 지켜 줘요. 그동안 장의 깊은 맛이 채소에 천천히 배어들어요. 밭에서 거둔 고추와 깻잎으로도 담가 봐요.', ['물기가 빠지면 오래 두어요'], '🫙'],
    ], ['장아찌', '채소를 장 속에 쏙 숨겨 두어요 🫙', [['채소를 간장이나 된장에 넣어요', 0], ['장맛이 스며들어요', [['🥕', '무'], ['🟤', '된장'], ['⏳', '기다림']]], ['오래 두고 먹는 반찬이에요 🍚', 1]]], [E('E0048641'), E('E0051716')], ['EDU_DOENJANG', 'EDU_GANJANG']);
    quiz('QZ_R_JANGAJJI_1', 'EDU_R_JANGAJJI', '장아찌가 오래 두고 먹을 수 있는 까닭은?', ['장의 짠맛이 물기를 빼고 상하지 않게 해서', '얼음에 넣어 두어서', '설탕만 넣어서', '날마다 끓여서'], 0, '간장·된장·고추장의 짠맛이 채소의 물기를 빼고 상하지 않게 지켜 줘요.', ['무를 된장 속에 박아 두면 무엇이 될까요?', [['🫙', '장아찌'], ['🍰', '케이크'], ['🍦', '아이스크림']], 0, '오래 두고 먹는 반찬이에요 🍚', '맞아요! 무장아찌가 돼요.']);

    card('EDU_R_TEA', 'foods', '🍵', '떡차 — 묵혀 마시는 차', '찻잎을 쪄서 찧어 엽전 모양으로 빚고 가운데 구멍을 뚫어 꿰어 말린 뒤 오래 묵혀요.', [
      ['엽전처럼 생긴 차', '전라남도 장흥에는 청태전이라는 떡차가 전해져요. 찻잎을 쪄서 찧고 동그랗게 빚어 가운데 구멍을 뚫은 뒤 줄에 꿰어 말려요. 돈차·떡차라고도 불렀어요.', ['엽전: 가운데 구멍이 뚫린 옛 동전', '국가무형유산 ‘제다’(차 만들기) 2016년 지정'], [['🍃', '찻잎'], ['♨️', '찌기'], ['🪙', '엽전 모양'], ['🧵', '꿰어 묵히기']]],
      ['묵히면 맛이 변해요', '바람 잘 드는 곳에서 오래 묵히는 동안 미생물과 공기가 찻잎의 맛을 천천히 바꿔 부드럽고 구수해져요. 이런 차를 ‘후발효차’라고 해요. 고구려 옛 무덤에서도 떡차가 나왔다고 해요.', ['후발효차: 만든 뒤에 오래 묵히며 발효시키는 차'], '🍵'],
    ], ['떡차', '엽전처럼 생긴 차를 줄에 꿰어 묵혀요 🪙', [['찻잎을 쪄서 동그랗게 빚어요', 0], ['가운데 구멍을 뚫어 꿰어요', [['🍃', '찻잎'], ['🪙', '동그랗게'], ['🧵', '꿰기']]], ['오래 묵히면 맛이 부드러워져요 🍵', 1]]], [F('detail/8988'), E('E0076955'), N('일상다반사', 'https://www.nongsaro.go.kr/portal/ps/psv/psvr/psvrc/rdaInterDtl.ps?&menuId=PS00063&cntntsNo=209162')], ['EDU_REGION_JANG']);
    quiz('QZ_R_TEA_1', 'EDU_R_TEA', '장흥의 청태전처럼 엽전 모양으로 빚어 묵히는 차를 무엇이라고 할까요?', ['떡차', '보리차', '꽃차', '얼음차'], 0, '찻잎을 쪄 찧어 엽전처럼 빚은 차를 떡차·돈차라고 하고, 오래 묵히며 발효시켜 후발효차라고도 해요.', ['떡차는 가운데에 무엇이 있을까요?', [['⭕', '구멍'], ['🍓', '딸기'], ['🍬', '사탕']], 0, '줄에 꿰려면 무엇이 필요할까요? 🧵', '맞아요! 구멍을 뚫어 줄에 꿰어요.']);

    // ============================================================ 발효 과학
    card('EDU_SCI_MICROBES', 'science', '🔬', '발효의 세 친구', '발효를 일으키는 미생물은 크게 곰팡이·효모·세균이에요. 음식마다 주인공이 달라요.', [
      ['세 친구를 소개해요', '곰팡이는 실처럼 뻗어 자라며 메주와 누룩에서 일해요. 효모는 동그란 모양으로 단맛을 알코올과 가스로 바꿔요. 세균은 아주 작은 막대나 공 모양으로, 젖산균·고초균·초산균이 있어요.', ['곰팡이: 메주·누룩', '효모: 증편·밑술', '세균: 김치·청국장·식초'], { type: 'svg', svg: SVG.microbes }],
      ['보이지 않을 만큼 작아요', '세균 하나는 머리카락 굵기보다 수십 배나 작아서 현미경으로만 볼 수 있어요. 하지만 수없이 많이 모여 일하면 음식의 맛과 향이 완전히 바뀌어요.', ['현미경: 아주 작은 것을 크게 보여 주는 기구'], '🔬'],
    ], ['발효의 세 친구', '곰팡이, 효모, 세균! 세 친구가 음식을 맛있게 바꿔요 🦠', [['곰팡이·효모·세균이 있어요', 0], ['음식마다 일하는 친구가 달라요', [['🫘', '메주: 곰팡이'], ['🍡', '증편: 효모'], ['🥬', '김치: 세균']]], ['눈에 안 보일 만큼 작아요 🔬', 1]]], [E('E0068069'), F('발효식품')], ['EDU_FERMENT', 'EDU_SCI_LACTIC']);
    quiz('QZ_SCI_MICROBES_1', 'EDU_SCI_MICROBES', '발효를 일으키는 미생물 세 무리로 알맞은 것은?', ['곰팡이·효모·세균', '개미·벌·나비', '모래·자갈·흙', '해·달·별'], 0, '발효는 곰팡이·효모·세균 같은 미생물이 음식 성분을 바꾸며 일어나요.', ['발효를 일으키는 작은 친구가 아닌 것은?', [['🐶', '강아지'], ['🦠', '세균'], ['🍄', '곰팡이']], 0, '눈에 보이는 커다란 동물이에요 🐶', '맞아요! 강아지는 미생물이 아니에요.']);
    quiz('QZ_SCI_MICROBES_2', 'EDU_SCI_MICROBES', '메주와 누룩에서 실처럼 뻗어 자라며 일하는 미생물은?', ['곰팡이', '효모', '젖산균', '초산균'], 0, '곰팡이는 실처럼 뻗어 자라며 메주와 누룩에서 녹말과 단백질을 나누는 효소를 만들어요.', null);

    card('EDU_SCI_LACTIC', 'science', '🦠', '젖산균 — 새콤함의 주인공', '젖산균은 채소의 단맛을 젖산으로 바꿔 김치를 새콤하게 하고, 다른 균이 자라지 못하게 해요.', [
      ['김치가 시어지는 까닭', '김치가 익는 동안 젖산균이 저절로 늘어나요. 젖산균은 배추와 무의 당을 먹고 젖산 같은 산을 만들어요. 그래서 김치가 점점 새콤해져요.', ['젖산: 새콤한 맛을 내는 산', '산: 신맛을 내는 성분'], [['🥬', '채소의 당'], ['🦠', '젖산균'], ['🍋', '젖산'], ['😋', '새콤']]],
      ['산이 지켜 줘요', '김치 국물이 새콤해지면 상하게 하는 다른 균이 잘 자라지 못해요. 소금과 젖산이 함께 김치를 오래 지켜 주는 거예요. 온도가 낮으면 젖산균이 천천히 일해서 김치도 천천히 익어요.', ['낮은 온도 → 천천히 익어요'], M('kimchi', '익어 가는 김치')],
    ], ['젖산균', '젖산균이 김치를 새콤하게 만들어요 🦠', [['젖산균이 채소의 단맛을 먹어요', 0], ['새콤한 젖산을 만들어요', [['🥬', '단맛'], ['🦠', '젖산균'], ['🍋', '새콤']]], ['추우면 천천히 익어요 ❄️', 1]]], [N('김치 발효', 'https://www.nongsaro.go.kr/portal/viewer/result/cms_contents/1202/viewer/207969_MF_ATTACH_02.hwp.view.xhtml')], ['EDU_KIMCHI', 'EDU_SCI_TEMP']);
    quiz('QZ_SCI_LACTIC_1', 'EDU_SCI_LACTIC', '젖산균이 채소의 당을 바꾸어 만드는 것은?', ['젖산', '소금', '설탕', '물'], 0, '젖산균은 채소의 당을 젖산 같은 산으로 바꿔 김치를 새콤하게 해요.', ['김치를 새콤하게 하는 친구는?', [['🦠', '젖산균'], ['🐝', '꿀벌'], ['🌞', '해님']], 0, '김치 속 작은 세균이에요 🦠', '맞아요! 젖산균이에요.']);
    quiz('QZ_SCI_LACTIC_2', 'EDU_SCI_LACTIC', '김치 국물이 새콤해지면 생기는 좋은 점은?', ['상하게 하는 다른 균이 잘 자라지 못한다', '김치가 하얗게 변한다', '김치가 얼지 않는다', '소금이 필요 없어진다'], 0, '산이 많아지면 다른 균이 자라기 어려워져서, 소금과 함께 김치를 오래 지켜 줘요.', null);

    card('EDU_SCI_KOJI', 'science', '🫘', '고초균과 메주', '볏짚과 흙에 사는 고초균이 메주와 청국장에서 콩의 단백질을 잘게 나눠 구수한 맛을 만들어요.', [
      ['볏짚에서 콩으로', '메주를 볏짚으로 묶어 매달거나 볏짚 위에서 띄우면, 볏짚에 사는 고초균이 메주로 옮겨 가요. 겉에는 곰팡이도 피어 함께 일해요.', ['띄우다: 미생물이 자라도록 따뜻하게 두다'], [['🌾', '볏짚'], ['🦠', '고초균'], ['🫘', '메주'], ['🟤', '장']]],
      ['구수한 맛이 생기는 까닭', '고초균과 곰팡이가 만든 효소가 콩의 단백질을 아주 잘게 잘라요. 잘게 잘린 조각들이 감칠맛과 구수한 맛을 내요.', ['단백질 → 작은 조각 → 감칠맛'], M('meju', '볏짚에 매단 메주')],
    ], ['고초균', '볏짚 속 고초균이 메주를 구수하게 바꿔요 🌾', [['메주를 볏짚에 매달아요', 1], ['고초균이 옮겨 가요', [['🌾', '볏짚'], ['🦠', '고초균'], ['🫘', '메주']]], ['그래서 장이 구수해요 😋', 0]]], [N('메주 띄우기', 'https://www.nongsaro.go.kr/portal/ps/psb/psby/vodPlay.ps?mvpNo=554&mvpClipNo=2'), F('메주쑤기')], ['EDU_BEAN', 'EDU_R_CHEONGGUKJANG']);
    quiz('QZ_SCI_KOJI_1', 'EDU_SCI_KOJI', '메주를 볏짚으로 묶어 두는 까닭으로 알맞은 것은?', ['볏짚에 사는 고초균이 메주로 옮겨 가서', '볏짚이 달아서', '메주를 예쁘게 꾸미려고', '쥐가 볏짚을 싫어해서'], 0, '볏짚에는 고초균이 살아요. 볏짚과 함께 띄우면 균이 메주로 옮겨 가 발효가 잘 돼요.', ['메주는 무엇으로 묶어 매달까요?', [['🌾', '볏짚'], ['🎀', '리본'], ['🧵', '실']], 0, '벼를 거두고 남은 줄기예요 🌾', '맞아요! 볏짚으로 묶어요.']);

    card('EDU_SCI_ACETIC', 'science', '🌬️', '초산균 — 공기를 좋아해요', '초산균은 공기 속 산소를 써서 알코올을 초산으로 바꿔요. 식초의 신맛이 여기서 나와요.', [
      ['숨 쉬는 세균', '초산균은 산소가 있어야 일하는 세균이에요. 밑술 표면에 얇은 막을 만들며 알코올을 초산으로 바꿔요. 이 막을 ‘초막’이라고 불러요.', ['산소: 우리가 숨 쉴 때 마시는 공기 속 기체'], [['🍶', '밑술'], ['🌬️', '공기'], ['🦠', '초산균'], ['🍋', '초산']]],
      ['그래서 천을 덮어요', '식초 항아리 입구를 꼭 막으면 초산균이 숨을 못 쉬어요. 그래서 천이나 한지로 덮어 먼지는 막고 공기는 통하게 해요.', ['막기보다 덮기'], '🌬️'],
    ], ['초산균', '초산균은 공기를 좋아해요 🌬️', [['초산균이 술을 식초로 바꿔요', 0], ['공기가 있어야 일해요', [['🍶', '밑술'], ['🌬️', '공기'], ['🍋', '식초']]], ['그래서 천을 살짝 덮어요 🧺', 1]]], [F('detail/7823'), N('식초 발효', 'https://www.nongsaro.go.kr/portal/ps/psv/psvr/psvrc/rdaInterDtl.ps?menuId=PS00063&cntntsNo=34315')], ['EDU_R_VINEGAR']);
    quiz('QZ_SCI_ACETIC_1', 'EDU_SCI_ACETIC', '초산균이 일하려면 꼭 있어야 하는 것은?', ['산소(공기)', '어둠', '얼음', '설탕만'], 0, '초산균은 산소를 써서 알코올을 초산으로 바꾸는 세균이라 공기가 필요해요.', ['식초 항아리는 꽁꽁 막아 두어야 할까요?', false, '초산균은 숨을 쉬어야 해요 🌬️', '아니에요! 천으로 살짝 덮어요.']);

    card('EDU_SCI_YEAST', 'science', '🫧', '효모 — 부풀리는 친구', '효모는 단맛을 먹고 가스를 내뿜어요. 그 가스가 반죽을 부풀리고 거품을 만들어요.', [
      ['동그란 작은 친구', '효모는 동그란 모양의 아주 작은 곰팡이 무리예요. 단맛(당)을 먹고 가스와 알코올을 만들어요. 반죽 속에서 가스가 생기면 작은 구멍들이 생겨 폭신해져요.', ['가스: 눈에 안 보이는 기체'], [['🍚', '단맛'], ['🫧', '효모'], ['💨', '가스'], ['🍡', '폭신']]],
      ['따뜻해야 잘 일해요', '효모는 따뜻한 곳에서 잘 일해요. 그래서 증편 반죽은 따뜻한 부뚜막 곁에 두어 부풀렸어요. 너무 뜨거우면 효모가 일을 멈춰요.', ['알맞은 온기가 중요해요'], '♨️'],
    ], ['효모', '효모가 보글보글 반죽을 부풀려요 🫧', [['효모는 단맛을 좋아해요', 0], ['가스를 뿜어 부풀려요', [['🍚', '반죽'], ['🫧', '효모'], ['🍡', '폭신']]], ['따뜻해야 잘 일해요 ♨️', 1]]], [F('detail/8052'), F('누룩')], ['EDU_R_JEUNGPYEON', 'EDU_R_NURUK']);
    quiz('QZ_SCI_YEAST_1', 'EDU_SCI_YEAST', '효모가 단맛을 먹고 만들어 반죽을 부풀리는 것은?', ['가스', '소금', '얼음', '모래'], 0, '효모는 당을 먹고 가스를 내뿜어 반죽에 작은 구멍을 만들고 부풀려요.', ['효모는 추운 곳에서 더 잘 일할까요?', false, '따뜻한 부뚜막 곁에 두었어요 ♨️', '아니에요! 따뜻해야 잘 일해요.']);

    card('EDU_SCI_ENZYME', 'science', '🧪', '효소 — 잘게 자르는 가위', '효소는 생물이 만드는 단백질이에요. 녹말이나 단백질을 잘게 잘라 단맛과 감칠맛을 만들어요.', [
      ['효소는 살아 있지 않아요', '효소는 미생물이나 싹튼 곡식이 만든 물질이에요. 스스로 늘어나지는 않지만 가위처럼 큰 성분을 작게 잘라요. 엿기름 속 효소는 녹말을 단맛으로 바꿔요.', ['녹말: 쌀·보리·감자에 많은 성분'], [['🍚', '녹말'], ['✂️', '효소'], ['🍯', '단맛']]],
      ['온도가 중요해요', '엿기름 효소는 60~70℃쯤에서 가장 잘 일해요. 그래서 식혜는 따뜻한 솥에서 삭혀요. 너무 끓이면 효소가 망가져 일을 멈춰요.', ['식혜 삭히기: 60~70℃에서 4~5시간'], '🌡️'],
    ], ['효소', '효소는 잘게 자르는 가위 같아요 ✂️', [['효소가 녹말을 잘라요', 0], ['잘린 조각은 달아요', [['🍚', '녹말'], ['✂️', '효소'], ['🍯', '단맛']]], ['따뜻한 솥에서 잘 일해요 ♨️', 1]]], [E('E0032592'), F('식혜')], ['EDU_R_SIKHYE', 'EDU_SCI_KOJI']);
    quiz('QZ_SCI_ENZYME_1', 'EDU_SCI_ENZYME', '엿기름 속 효소가 녹말을 단맛으로 바꾸는 일을 무엇이라고 할까요?', ['당화', '증발', '냉동', '산화'], 0, '녹말이 단맛 나는 당으로 바뀌는 것을 당화라고 해요. 식혜와 조청이 이렇게 만들어져요.', ['효소는 무엇처럼 성분을 잘게 자를까요?', [['✂️', '가위처럼'], ['🧲', '자석처럼'], ['🎈', '풍선처럼']], 0, '자르는 도구예요 ✂️', '맞아요! 가위처럼 잘라요.']);

    card('EDU_SCI_SALT', 'science', '🧂', '소금의 힘', '소금은 상하게 하는 균을 막고, 이로운 미생물이 천천히 일하도록 도와줘요.', [
      ['짠물 속에서 생기는 일', '소금물 속에서는 많은 균이 몸의 물을 빼앗겨 자라지 못해요. 소금에 강한 이로운 미생물과 효소만 천천히 일해서 장과 젓갈이 오래 익어요.', ['염도: 물에 녹은 소금의 진한 정도'], [['🧂', '소금'], ['🚫', '나쁜 균'], ['🦠', '이로운 균'], ['🏺', '천천히']]],
      ['알맞은 소금이 중요해요', '소금이 너무 적으면 음식이 상하고, 너무 많으면 발효가 거의 일어나지 않아요. 장을 담글 때 소금물의 진하기를 잘 맞추는 것이 장맛을 좌우해요.', ['장 담그기 소금물: 18~20도쯤(옛 방식)'], '⚖️'],
    ], ['소금의 힘', '소금이 나쁜 균을 막아 줘요 🧂', [['짠물에서는 나쁜 균이 못 자라요', 0], ['착한 균은 천천히 일해요', [['🧂', '소금'], ['🦠', '착한 균'], ['🏺', '장']]], ['너무 많아도 적어도 안 돼요 ⚖️', 1]]], [F('detail/4784'), F('새우젓')], ['EDU_JANG_SALTWATER', 'EDU_R_JEOTGAL']);
    quiz('QZ_SCI_SALT_1', 'EDU_SCI_SALT', '장을 담글 때 소금이 하는 일로 알맞은 것은?', ['상하게 하는 균을 막는다', '장을 하얗게 만든다', '장을 얼린다', '장을 달게 만든다'], 0, '소금은 상하게 하는 균이 자라지 못하게 막고, 이로운 미생물이 천천히 일하게 해요.', ['소금은 많이 넣을수록 언제나 좋을까요?', false, '알맞은 양이 중요해요 ⚖️', '아니에요! 너무 많으면 발효가 안 돼요.']);

    card('EDU_SCI_TEMP', 'science', '🌡️', '온도와 기다림', '미생물은 알맞은 온도에서 잘 일해요. 같은 음식도 날씨와 계절에 따라 익는 빠르기가 달라요.', [
      ['음식마다 좋아하는 온도', '김치는 서늘한 4~15℃에서 천천히 익을 때 맛이 좋고, 청국장은 40℃쯤 따뜻해야 잘 떠요. 식초의 초산균은 25~30℃를 좋아해요.', ['체험관 장독도 온도·습도에 따라 빠르기가 달라요'], [['❄️', '김치'], ['🌤️', '장'], ['☀️', '식초'], ['🔥', '청국장']]],
      ['기다림의 지혜', '옛사람들은 계절에 맞춰 발효 음식을 담갔어요. 추운 입동 무렵에는 김장을, 따뜻해지는 봄 앞에는 장을 담가 알맞은 온도에서 천천히 익게 했어요.', ['계절 = 자연이 맞춰 주는 온도'], { type: 'svg', svg: SVG.agingTimeline }],
    ], ['온도와 기다림', '음식마다 좋아하는 온도가 달라요 🌡️', [['김치는 시원한 걸 좋아해요 ❄️', 0], ['청국장은 따뜻한 걸 좋아해요', [['❄️', '김치'], ['☀️', '식초'], ['🔥', '청국장']]], ['계절에 맞춰 담갔어요 🍂', 1]]], [N('김치 발효', 'https://www.nongsaro.go.kr/portal/viewer/result/cms_contents/1202/viewer/207969_MF_ATTACH_02.hwp.view.xhtml'), F('detail/8082')], ['EDU_SCI_LACTIC', 'EDU_SEASON_24']);
    quiz('QZ_SCI_TEMP_1', 'EDU_SCI_TEMP', '다음 중 가장 따뜻한 곳에서 만드는 발효 음식은?', ['청국장', '동치미', '백김치', '나박김치'], 0, '청국장은 40℃쯤 따뜻한 아랫목에서 띄우고, 물김치들은 서늘한 곳에서 익혀요.', ['김치는 시원한 곳에서 천천히 익혀요. 맞을까요?', true, '김장 김치를 떠올려 봐요 ❄️', '맞아요! 시원하면 천천히 맛있게 익어요.']);

    // ============================================================ 장 담그기와 절기
    card('EDU_JANG_MEJU_TIME', 'jang', '🍂', '메주 쑤는 때', '늦가을 입동 무렵 햇콩을 거두면 메주를 쒀요. 겨울 동안 띄워 봄 앞에 장을 담가요.', [
      ['한 해의 장 달력', '가을에 콩을 거두면 입동 무렵(10~12월)에 메주를 쒀요. 콩을 고르고 씻어 불린 뒤 삶아 찧고, 네모나게 빚어 겉을 말린 다음 따뜻한 곳에서 띄워요.', ['입동: 겨울이 시작되는 절기(11월 초)'], [['🫘', '고르기'], ['💧', '불리기'], ['🔥', '삶기'], ['🧱', '빚기'], ['🌾', '띄우기']]],
      ['겨울을 나는 메주', '띄운 메주는 처마 밑이나 방 안에 매달아 겨울을 나요. 볏짚과 공기 속 미생물이 메주 속으로 퍼지며 단단하게 익어요.', ['처마: 지붕이 벽 밖으로 나온 부분'], M('meju', '매달아 말리는 메주')],
    ], ['메주 쑤는 때', '추워지기 시작하면 콩을 삶아 메주를 만들어요 🍂', [['가을에 콩을 거둬요 🫘', 0], ['삶아서 네모나게 빚어요', [['🫘', '콩'], ['🔥', '삶기'], ['🧱', '메주']]], ['겨울 내내 매달아 띄워요 ❄️', 1]]], [F('메주쑤기'), F('detail/4784')], ['EDU_BEAN', 'EDU_SEASON_WINTER']);
    quiz('QZ_JANG_MEJU_TIME_1', 'EDU_JANG_MEJU_TIME', '메주를 주로 쑤는 때는?', ['입동 무렵 늦가을', '한여름 장마철', '이른 봄 꽃필 때', '한겨울 설날 아침'], 0, '가을에 콩을 거둔 뒤 입동 무렵(10~12월)에 메주를 쑤어 겨울 동안 띄워요.', ['메주를 만드는 순서에서 콩을 삶은 다음 하는 일은?', [['🧱', '찧어서 빚기'], ['🧊', '얼리기'], ['🍬', '설탕 바르기']], 0, '네모난 모양으로 만들어요 🧱', '맞아요! 찧어서 빚어요.']);

    card('EDU_JANG_DAY', 'season', '📅', '장 담그는 날', '장은 보통 음력 정월부터 삼월 사이에 담가요. 날을 가려 정성껏 담그는 풍습이 있었어요.', [
      ['언제 담글까요?', '장은 음력 정월(1월)에서 삼월 사이, 날이 아직 서늘할 때 담가요. 서늘할 때 담가야 소금물 속에서 장이 천천히 맛있게 익어요. 늦게 담글수록 소금을 조금 더 넣어요.', ['음력: 달을 기준으로 한 옛 달력'], '📅'],
      ['날을 가려요', '옛사람들은 장 담그는 날을 정성껏 골랐어요. 장 담그는 날에는 몸가짐을 바르게 하고, 다 담근 뒤에는 금줄을 둘러 장맛을 지키려는 마음을 담았어요.', ['풍습: 오래 이어 온 생활 습관'], [['📅', '날 고르기'], ['🧂', '장 담그기'], ['🪢', '금줄 두르기']]],
    ], ['장 담그는 날', '아직 서늘한 봄 앞에 장을 담가요 📅', [['정월에서 삼월 사이에 담가요', 0], ['좋은 날을 골라 정성껏 담가요', [['📅', '날 고르기'], ['🧂', '담그기'], ['🪢', '금줄']]], ['서늘해야 천천히 맛있게 익어요 🌬️', 1]]], [F('detail/4784'), E('E0076963')], ['EDU_JANG_SALTWATER', 'EDU_ONGGI_CARE']);
    quiz('QZ_JANG_DAY_1', 'EDU_JANG_DAY', '장을 주로 담그는 때로 알맞은 것은?', ['음력 정월~삼월', '음력 칠월 한여름', '음력 구월 추석 무렵', '아무 때나 똑같다'], 0, '장은 날이 아직 서늘한 음력 정월에서 삼월 사이에 담가 천천히 익게 해요.', ['장을 담근 뒤 장독에 두르는 줄은?', [['🪢', '금줄'], ['🎀', '리본'], ['🧶', '털실']], 0, '새끼줄에 고추와 숯을 끼워요 🪢', '맞아요! 금줄이에요.']);

    card('EDU_JANG_SALTWATER', 'jang', '🥚', '소금물 맞추기', '장을 담글 소금물의 진하기를 옛사람들은 달걀을 띄워 가늠했어요.', [
      ['달걀이 떠오르는 높이', '물에 소금을 녹이며 달걀을 띄워 보면, 소금이 진할수록 달걀이 더 높이 떠올라요. 달걀이 물 위로 동전만큼 드러나면 알맞다고 여겼어요. 그렇게 맞춘 소금물은 18~20도쯤이에요.', ['진할수록 물체가 더 잘 떠요(부력)'], '🥚'],
      ['왜 정확해야 할까요?', '소금물이 싱거우면 장이 상하기 쉽고, 너무 짜면 미생물이 거의 일하지 못해 맛이 덜 들어요. 날이 따뜻해지는 늦은 때에 담글수록 소금을 조금 더 넣어요.', ['싱거우면 상하고, 짜면 덜 익어요'], [['💧', '물'], ['🧂', '소금'], ['🥚', '달걀 띄우기'], ['✅', '알맞음']]],
    ], ['소금물 맞추기', '달걀을 띄워 소금물을 맞춰요 🥚', [['소금을 넣을수록 달걀이 떠올라요', 0], ['동전만큼 보이면 알맞아요', [['💧', '물'], ['🧂', '소금'], ['🥚', '동동']]], ['너무 싱겁거나 짜면 안 돼요 ⚖️', 1]]], [F('detail/4784')], ['EDU_SCI_SALT', 'EDU_GANJANG']);
    quiz('QZ_JANG_SALTWATER_1', 'EDU_JANG_SALTWATER', '소금물에 달걀을 띄울 때, 소금이 진할수록 달걀은?', ['더 높이 떠오른다', '더 깊이 가라앉는다', '깨진다', '색이 변한다'], 0, '소금이 많이 녹은 진한 물일수록 물체를 더 세게 밀어 올려 달걀이 더 높이 떠요.', ['소금물이 진하면 달걀이 동동 떠요. 맞을까요?', true, '바닷물에서 몸이 더 잘 뜨는 것처럼요 🌊', '맞아요! 진할수록 잘 떠요.']);

    card('EDU_JANG_SPLIT', 'jang', '✂️', '장 가르기', '장을 담근 지 40~60일이 지나면 메주 건더기를 건져 된장으로, 남은 국물은 간장으로 나눠요.', [
      ['메주 하나로 두 가지 장', '소금물에 담근 메주는 40~60일 동안 맛 성분을 국물에 우려내요. 그때 메주를 건져 내는 일을 ‘장 가르기’라고 해요. 국물은 간장, 건더기는 된장이 돼요.', ['장을 뜨다: 국물과 건더기를 나누다'], [['🏺', '장 담그기'], ['⏳', '40~60일'], ['✂️', '장 가르기'], ['🫙', '간장'], ['🟤', '된장']]],
      ['그다음은 따로 익혀요', '건진 메주는 으깨어 치대고 다른 독에 꾹꾹 눌러 담아 된장으로 익혀요. 국물은 달여서(한 번 끓여서) 간장으로 오래 익혀요. 체험관 장독대에서도 장 가르기를 해 볼 수 있어요.', ['달이다: 끓여서 진하게 하다'], M('doenjang', '된장')],
    ], ['장 가르기', '국물은 간장, 건더기는 된장으로 나눠요 ✂️', [['메주를 소금물에 담가 기다려요 ⏳', 0], ['메주를 건져 나눠요', [['🏺', '장'], ['🫙', '간장'], ['🟤', '된장']]], ['장독대에서 직접 해 봐요! ✂️', 1]]], [F('detail/4784'), E('E0076963')], ['EDU_DOENJANG', 'EDU_GANJANG']);
    quiz('QZ_JANG_SPLIT_1', 'EDU_JANG_SPLIT', '장 가르기는 보통 장을 담근 지 얼마쯤 지나서 할까요?', ['40~60일', '하루', '1년', '10분'], 0, '장을 담근 지 40~60일쯤 지나 메주를 건져 간장과 된장으로 나눠요.', ['장 가르기 뒤 건더기는 무엇이 될까요?', [['🟤', '된장'], ['🍶', '식초'], ['🥛', '우유']], 0, '구수한 갈색 장이에요 🟤', '맞아요! 된장이 돼요.']);
    quiz('QZ_JANG_SPLIT_2', 'EDU_JANG_SPLIT', '장 가르기 뒤 국물로 만드는 것은?', ['간장', '고추장', '식혜', '김치'], 0, '메주를 건져 낸 국물은 달여서 간장으로 익혀요.', null);

    card('EDU_JANG_SEED', 'jang', '🫙', '씨간장과 덧장', '묵은 간장(씨간장)이나 묵은 장을 새 장에 더해 맛을 이어 가는 것도 우리 장의 특징이에요.', [
      ['씨간장은 무엇일까요?', '해마다 장을 담그면서 오래 묵은 간장을 조금씩 남겨 두었다가 새 간장에 더했어요. 이렇게 맛의 씨앗처럼 이어 가는 간장을 ‘씨간장’이라고 불러요.', ['겹장: 묵은 장에 새 장을 더하는 방법'], '🫙'],
      ['덧장', '익어 가는 장에 같은 장을 더하는 것을 덧장이라고 해요. 묵은 장의 깊은 맛이 새 장으로 이어져요. 체험관 장독에서도 숙성 단계의 장에 덧장을 할 수 있어요.', ['맛을 잇는 지혜'], [['🫙', '묵은 장'], ['➕', '덧장'], ['🏺', '새 장'], ['😋', '깊은 맛']]],
    ], ['씨간장과 덧장', '묵은 장을 새 장에 더해 맛을 이어요 🫙', [['오래 묵은 간장을 남겨 두어요', 0], ['새 장에 더해요', [['🫙', '씨간장'], ['➕', '더하기'], ['🏺', '새 장']]], ['장독대에서 덧장을 해 봐요 ➕', 1]]], [E('E0076963'), UN_JANG], ['EDU_GANJANG', 'EDU_JANG_UNESCO']);
    quiz('QZ_JANG_SEED_1', 'EDU_JANG_SEED', '오래 묵은 간장을 남겨 새 간장에 더해 맛을 이어 가는 간장을 무엇이라 할까요?', ['씨간장', '새간장', '물간장', '꽃간장'], 0, '맛의 씨앗처럼 이어 가는 묵은 간장을 씨간장이라 하고, 묵은 장에 새 장을 더하는 방법을 겹장이라고 해요.', ['묵은 장을 새 장에 더하면 맛이 이어져요. 맞을까요?', true, '맛의 씨앗을 떠올려 봐요 🌱', '맞아요! 맛이 이어져요.']);

    card('EDU_JANG_UNESCO', 'jang', '🌏', '세계가 아끼는 장 담그기', '우리의 장 담그기 문화는 2024년 유네스코 인류무형문화유산 대표목록에 올랐어요.', [
      ['국가무형유산에서 세계유산으로', '장 담그기는 2018년 국가무형유산이 되었고, 2024년 12월 유네스코 인류무형문화유산 대표목록에 올랐어요. 메주를 띄우고 장을 담그고 나누는 지식과 믿음, 생활이 함께 인정받았어요.', ['무형유산: 노래·기술·풍습처럼 모양 없는 유산'], '🌏'],
      ['우리 장의 특징', '메주 하나로 간장과 된장 두 가지를 얻고, 묵은 장을 새 장에 더해 맛을 이어 가요. 가족과 마을이 함께 장을 담그고 나누는 공동체 문화이기도 해요.', ['메주 → 간장 + 된장', '씨간장 · 겹장 · 나눔'], [['🫘', '메주'], ['🏺', '장 담그기'], ['🫙', '간장'], ['🟤', '된장'], ['🤝', '나눔']]],
    ], ['세계가 아끼는 장', '우리 장 담그기는 세계가 아끼는 보물이에요 🌏', [['2024년 세계 유산 목록에 올랐어요', 0], ['메주 하나로 두 가지 장!', [['🫘', '메주'], ['🫙', '간장'], ['🟤', '된장']]], ['가족과 이웃이 함께 담그고 나눠요 🤝', 1]]], [E('E0076963'), UN_JANG], ['EDU_JANG_SEED', 'EDU_GIMJANG_UNESCO']);
    quiz('QZ_JANG_UNESCO_1', 'EDU_JANG_UNESCO', '우리 장 담그기 문화가 유네스코 인류무형문화유산 대표목록에 오른 해는?', ['2024년', '2013년', '2000년', '1990년'], 0, '장 담그기 문화는 2024년 12월 유네스코 대표목록에 올랐어요. 김장 문화는 2013년이에요.', ['우리 장 담그기는 세계가 아끼는 유산이에요. 맞을까요?', true, '유네스코 목록에 올랐어요 🌏', '맞아요! 2024년에 올랐어요.']);

    // ============================================================ 옹기
    card('EDU_ONGGI_MAKE', 'onggi', '⚱️', '옹기는 어떻게 만들까요?', '흙을 반죽해 물레 위에서 쌓아 올려 빚고, 잿물을 입혀 가마에서 높은 불로 구워요.', [
      ['흙에서 그릇으로', '옹기장이는 흙을 반죽해 길게 늘인 흙가래를 물레 위에서 한 단씩 쌓아 올리고, 안팎을 두드려 단단하게 빚어요. 잘 말린 뒤 잿물(나뭇재와 흙을 섞은 물)을 입혀요.', ['물레: 돌려 가며 그릇을 빚는 받침', '잿물: 나뭇재로 만든 유약'], [['🟫', '흙 반죽'], ['🔄', '물레'], ['🖐️', '두드리기'], ['💧', '잿물'], ['🔥', '가마']]],
      ['가마에서 굽기', '가마에서 높은 불로 오래 구우면 그릇 벽 속의 물기가 빠지며 아주 작은 구멍이 생겨요. 이 구멍 덕분에 옹기가 ‘숨 쉬는 그릇’이 돼요. 체험관 공방에서 가마를 찾아봐요.', ['가마: 그릇을 굽는 큰 화덕'], M('jar', '옹기 항아리')],
    ], ['옹기 만들기', '흙을 빚어 불에 구우면 옹기가 돼요 🔥', [['흙을 물레 위에서 쌓아 올려요 🔄', 0], ['잿물을 입혀요', [['🟫', '흙'], ['💧', '잿물'], ['🔥', '가마']]], ['불에 구우면 숨구멍이 생겨요 🌬️', 1]]], [E('E0038898')], ['EDU_JANGDOK', 'EDU_ONGGI_BREATH']);
    quiz('QZ_ONGGI_MAKE_1', 'EDU_ONGGI_MAKE', '옹기를 빚을 때 돌려 가며 흙을 쌓아 올리는 받침은?', ['물레', '맷돌', '절구', '키'], 0, '물레를 돌려 가며 흙가래를 쌓아 올리고 두드려 옹기를 빚어요.', ['옹기는 마지막에 어디에서 구울까요?', [['🔥', '가마'], ['🧊', '냉장고'], ['🛁', '욕조']], 0, '아주 뜨거운 불이 있는 곳이에요 🔥', '맞아요! 가마에서 구워요.']);

    card('EDU_ONGGI_KINDS', 'onggi', '🏺', '독·중두리·항아리·단지', '옹기는 크기와 모양에 따라 이름이 달라요. 담는 것도 달라요.', [
      ['크기 순서대로', '가장 큰 독에는 간장·된장·김장 김치처럼 많은 양을 담았어요. 중두리는 독보다 조금 작고 배가 불룩해요. 항아리는 아가리가 좁고 배가 부르며, 단지는 작고 목이 짧아요.', ['아가리: 그릇의 입구'], [['🏺', '독'], ['🏺', '중두리'], ['🏺', '항아리'], ['🫙', '단지']]],
      ['체험관 장독에서도', '체험관의 내 장독 12개도 독·중두리·항아리·단지로 되어 있어요. 레시피가 좋아하는 옹기에 담그면 품질이 더 좋아요.', ['장독마다 종류를 확인해 봐요'], M('jar', '항아리')],
    ], ['옹기 이름', '크기마다 이름이 달라요! 독, 중두리, 항아리, 단지 🏺', [['가장 큰 건 독이에요', 0], ['크기 순서대로 알아봐요', [['🏺', '독'], ['🏺', '항아리'], ['🫙', '단지']]], ['장독대에서 내 장독 종류를 찾아봐요 🔍', 1]]], [E('E0048394'), E('E0038898')], ['EDU_JANGDOK', 'EDU_ONGGI_REGION']);
    quiz('QZ_ONGGI_KINDS_1', 'EDU_ONGGI_KINDS', '가장 큰 옹기로 간장·된장·김장 김치를 많이 담던 것은?', ['독', '단지', '종지', '뚝배기'], 0, '독은 가장 큰 옹기로 많은 양을 오래 담가 두는 데 썼어요.', ['가장 작은 옹기는 무엇일까요?', [['🫙', '단지'], ['🏺', '독'], ['🛁', '욕조']], 0, '꿀이나 참기름을 담아요 🍯', '맞아요! 단지가 작아요.']);

    card('EDU_ONGGI_BREATH', 'onggi', '🌬️', '숨 쉬는 그릇의 비밀', '옹기 벽에는 눈에 안 보이는 작은 구멍이 있어 공기가 아주 조금씩 드나들어요.', [
      ['작은 구멍(기공)', '옹기를 높은 온도로 구울 때 흙 속에 있던 물기가 빠져나가며 아주 작은 구멍이 생겨요. 물은 새지 않을 만큼 작지만 공기는 조금씩 드나들 수 있어요.', ['기공: 아주 작은 구멍'], [['🔥', '굽기'], ['💨', '물기 빠짐'], ['⚫', '작은 구멍'], ['🌬️', '공기']]],
      ['장이 숨을 쉬어요', '공기가 조금씩 드나들어 안의 장과 김치가 알맞게 익어요. 그래서 옛사람들은 장을 옹기에 담고, 맑은 날에는 뚜껑을 열어 햇볕과 바람도 쐬어 주었어요.', ['볕 쬐기와 바람 쐬기'], { type: 'svg', svg: SVG.jangdokdae }],
    ], ['숨 쉬는 옹기', '옹기에는 아주 작은 숨구멍이 있어요 🌬️', [['구울 때 작은 구멍이 생겨요 🔥', 0], ['공기가 솔솔 드나들어요', [['🏺', '옹기'], ['⚫', '숨구멍'], ['🌬️', '공기']]], ['그래서 장이 맛있게 익어요 😋', 1]]], [E('E0038898')], ['EDU_JANGDOK', 'EDU_ONGGI_MAKE']);
    quiz('QZ_ONGGI_BREATH_1', 'EDU_ONGGI_BREATH', '옹기 벽의 작은 구멍은 언제 생길까요?', ['높은 온도로 구울 때 흙 속 물기가 빠지며', '사람이 바늘로 뚫어서', '벌레가 갉아 먹어서', '비를 맞아서'], 0, '가마에서 높은 온도로 구울 때 흙 속 물기가 빠져나가며 아주 작은 구멍(기공)이 생겨요.', ['옹기 숨구멍으로 물이 줄줄 샐까요?', false, '물은 못 지나갈 만큼 작아요 💧', '아니에요! 공기만 조금씩 드나들어요.']);

    card('EDU_ONGGI_REGION', 'onggi', '🗺️', '고장마다 다른 옹기 모양', '날씨가 다른 고장마다 옹기 모양도 조금씩 달랐어요.', [
      ['볕과 날씨에 맞춘 모양', '볕이 적고 추운 중부·북부 지방은 햇볕을 많이 받도록 입을 넓게 만들었고, 더운 남부 지방은 입을 좁히고 어깨를 넓혔다고 해요. 경상도 옹기는 수박처럼 배가 부르다고 알려져 있어요.', ['어깨: 그릇 위쪽의 넓은 부분'], '🗺️'],
      ['생활이 만든 모양', '그 고장의 날씨, 흙, 담는 음식에 맞춰 옹기장이들이 모양을 다듬어 왔어요. 그래서 옹기 모양을 보면 어느 고장 것인지 짐작할 수 있대요.', ['모양 속에 지혜가 있어요'], [['❄️', '북쪽: 넓은 입'], ['☀️', '남쪽: 좁은 입'], ['🍉', '경상도: 둥근 배']]],
    ], ['고장마다 다른 옹기', '추운 고장 옹기는 입이 넓어요 🗺️', [['햇볕을 많이 받으려고 입을 넓혀요 ☀️', 0], ['고장마다 모양이 달라요', [['❄️', '넓은 입'], ['☀️', '좁은 입'], ['🍉', '둥근 배']]], ['모양을 보면 고장을 알 수 있어요 🔍', 1]]], [{ label: '경상일보 옹기 기사', url: 'https://www.ksilbo.co.kr/news/articleView.html?idxno=245819' }, E('E0038898')], ['EDU_ONGGI_KINDS']);
    quiz('QZ_ONGGI_REGION_1', 'EDU_ONGGI_REGION', '볕이 적고 추운 지방의 옹기 입은 어떻게 만들었다고 할까요?', ['넓게', '아주 좁게', '네모나게', '입이 없게'], 0, '추운 지방은 햇볕을 많이 받도록 입을 넓게, 더운 남부는 입을 좁게 만들었다고 해요.', null);

    card('EDU_ONGGI_CARE', 'onggi', '🧽', '장독 돌보기', '장독은 자주 닦고, 맑은 날엔 뚜껑을 열어 볕을 쬐고, 비가 오면 얼른 덮어요.', [
      ['볕 쬐기와 바람 쐬기', '맑은 날 아침이면 장독 뚜껑을 열어 햇볕과 바람을 쐬어 주었어요. 습기가 빠지고 장이 알맞게 익어요. 대신 비가 오면 빗물이 들어가지 않게 얼른 덮었어요.', ['볕: 햇볕'], [['☀️', '뚜껑 열기'], ['🌬️', '바람'], ['🌧️', '비 오면 덮기']]],
      ['반질반질 닦기', '장독을 자주 닦아 반질반질하게 관리했어요. 웃소금을 뿌려 겉에 곰팡이가 피지 않게 하고, 간장독에는 숯과 붉은 고추를 띄우기도 했어요. 체험관 장독에서 모두 해 볼 수 있어요.', ['웃소금: 장 위에 뿌리는 소금'], M('jar', '장독', { lidOpen: true })],
    ], ['장독 돌보기', '맑은 날엔 뚜껑을 열고, 비 오면 덮어요 ☀️🌧️', [['햇볕과 바람을 쐬어 줘요 ☀️', 0], ['깨끗이 닦고 웃소금을 뿌려요', [['🧽', '닦기'], ['🧂', '웃소금'], ['⚫', '숯']]], ['비가 오면 얼른 덮어요 🌧️', 1]]], [E('E0048394'), F('금줄')], ['EDU_JANGDOK', 'EDU_FOLK_GEUMJUL']);
    quiz('QZ_ONGGI_CARE_1', 'EDU_ONGGI_CARE', '장 위에 소금을 한 켜 뿌리는 것을 무엇이라 할까요?', ['웃소금', '꽃소금', '물소금', '단소금'], 0, '장이나 김치 맨 위에 뿌리는 소금을 웃소금이라 해요. 겉에 곰팡이가 피지 않게 지켜 줘요.', ['비가 올 때 장독 뚜껑은 어떻게 할까요?', [['🌧️', '얼른 덮어요'], ['☔', '활짝 열어요'], ['🎈', '날려 보내요']], 0, '빗물이 들어가면 안 돼요 🌧️', '맞아요! 얼른 덮어요.']);
    quiz('QZ_ONGGI_CARE_2', 'EDU_ONGGI_CARE', '맑은 날 장독 뚜껑을 열어 두는 까닭으로 알맞은 것은?', ['햇볕과 바람으로 습기를 빼려고', '장을 빨리 얼리려고', '새가 먹게 하려고', '장을 식히려고만'], 0, '맑은 날 뚜껑을 열면 햇볕과 바람이 습기를 빼 주어 장이 알맞게 익어요.', null);

    // ============================================================ 24절기와 농사
    card('EDU_SEASON_24', 'season', '🌞', '24절기 달력', '해가 하늘에서 지나는 길을 24칸으로 나눈 것이 24절기예요. 농사의 때를 알려 줘요.', [
      ['해를 보고 만든 달력', '해가 지나는 길을 15도씩 나누어 24개의 절기를 정했어요. 그래서 절기는 해마다 날짜가 거의 같아요. 봄의 입춘부터 겨울의 대한까지 이어져요.', ['절기: 계절을 알려 주는 날'], { type: 'model', model: 'season', caption: '사계절과 절기' }],
      ['농사의 길잡이', '농부들은 절기를 보고 씨 뿌릴 때, 모내기할 때, 거둘 때를 정했어요. 장 담그기와 김장도 절기에 맞춰 했어요. 체험관의 작물도 한국의 계절에 맞춰 자라요.', ['망종: 모내기·보리 베기 · 입동: 김장'], [['🌱', '입춘'], ['🌾', '망종'], ['🍂', '추분'], ['🥬', '입동']]],
    ], ['24절기', '해를 보고 만든 24개의 계절 날이에요 🌞', [['해가 지나는 길을 24칸으로 나눠요', 0], ['봄·여름·가을·겨울에 6개씩!', [['🌸', '봄'], ['☀️', '여름'], ['🍂', '가을'], ['❄️', '겨울']]], ['언제 씨 뿌릴지 알려 줘요 🌱', 1]]], [F('detail/8970'), E('E0017898')], ['EDU_FARMING', 'EDU_SEASON_SPRING']);
    quiz('QZ_SEASON_24_1', 'EDU_SEASON_24', '24절기는 해의 길을 몇 도씩 나눈 것일까요?', ['15도', '30도', '45도', '90도'], 0, '해가 지나는 길(360도)을 15도씩 나누면 24개의 절기가 돼요.', ['계절마다 절기가 몇 개씩 있을까요?', [['6️⃣', '6개'], ['1️⃣', '1개'], ['🔟', '10개']], 0, '24를 4계절로 나눠 봐요 ➗', '맞아요! 6개씩이에요.']);

    card('EDU_SEASON_SPRING', 'season', '🌸', '봄의 절기', '입춘에 봄을 맞고, 경칩에 개구리가 깨어나고, 곡우에 봄비가 내려 씨를 뿌려요.', [
      ['봄을 여는 절기', '입춘(2월 초)에는 대문에 봄을 반기는 글을 붙였어요. 경칩(3월 초)에는 겨울잠을 자던 개구리가 깨어난다고 했어요. 장은 아직 서늘한 이 무렵에 담가요.', ['입춘·우수·경칩·춘분·청명·곡우'], [['🌱', '입춘'], ['💧', '우수'], ['🐸', '경칩'], ['🌸', '춘분']]],
      ['씨 뿌리는 때', '곡우(4월 말)에는 곡식을 기르는 봄비가 내린다고 해요. 이 무렵 볍씨를 뿌리고 밭에 씨를 심었어요. 체험관 텃밭에서도 봄에 씨를 심어 봐요.', ['곡우: 곡식을 위한 비'], '🌧️'],
    ], ['봄의 절기', '개구리가 깨어나고 봄비가 내려요 🐸', [['입춘에 봄이 와요 🌱', 0], ['개구리가 깨어나요', [['🌱', '입춘'], ['🐸', '경칩'], ['🌧️', '곡우']]], ['봄비가 오면 씨를 뿌려요 🌧️', 1]]], [F('detail/8970'), E('E0017898')], ['EDU_SEASON_24', 'EDU_JANG_DAY']);
    quiz('QZ_SEASON_SPRING_1', 'EDU_SEASON_SPRING', '겨울잠 자던 개구리가 깨어난다는 절기는?', ['경칩', '동지', '하지', '상강'], 0, '경칩은 3월 초 무렵으로, 겨울잠 자던 개구리가 깨어난다고 했어요.', ['개구리가 깨어나는 봄 절기는?', [['🐸', '경칩'], ['❄️', '대한'], ['🍂', '상강']], 0, '봄에 있어요 🌸', '맞아요! 경칩이에요.']);

    card('EDU_SEASON_SUMMER', 'season', '☀️', '여름의 절기', '망종에는 모를 내고 보리를 베고, 하지에는 낮이 가장 길어요. 장마도 지나가요.', [
      ['바쁜 여름', '망종(6월 초)은 보리를 거두고 모를 내는 가장 바쁜 때예요. 하지(6월 말)는 일 년 중 낮이 가장 길어요. 이 무렵 감자를 캐고 장마를 준비해요.', ['모내기: 볏모를 논에 옮겨 심기'], [['🌾', '망종'], ['☀️', '하지'], ['🌧️', '장마'], ['🔥', '대서']]],
      ['여름의 발효', '날이 더우면 김치가 빨리 익어요. 그래서 여름에는 열무김치·오이소박이처럼 금방 먹는 김치를 조금씩 담그고, 증편처럼 잘 쉬지 않는 떡을 먹었어요. 장독은 볕을 쬐고 장마엔 꼭 덮었어요.', ['더우면 빨리 익어요'], '🥒'],
    ], ['여름의 절기', '낮이 가장 긴 날이 있어요 ☀️', [['모내기를 해요 🌾', 0], ['하지는 낮이 가장 길어요', [['🌾', '망종'], ['☀️', '하지'], ['🌧️', '장마']]], ['여름엔 김치가 빨리 익어요 🥒', 1]]], [F('detail/8970'), E('E0017898')], ['EDU_SEASON_24', 'EDU_R_YEOLMU']);
    quiz('QZ_SEASON_SUMMER_1', 'EDU_SEASON_SUMMER', '보리를 베고 모를 내는 바쁜 절기는?', ['망종', '입춘', '동지', '한로'], 0, '망종은 6월 초로 보리를 거두고 모를 내는 때예요.', ['여름에는 김치가 천천히 익을까요?', false, '더우면 젖산균이 빨리 일해요 ☀️', '아니에요! 여름엔 빨리 익어요.']);

    card('EDU_SEASON_AUTUMN', 'season', '🍂', '가을의 절기', '추분이 지나면 낮보다 밤이 길어지고, 상강에는 서리가 내려요. 거두는 계절이에요.', [
      ['거두는 기쁨', '가을에는 벼·콩·고추·배추를 거둬요. 추분(9월 말)에는 낮과 밤의 길이가 같아지고, 상강(10월 말)에는 첫서리가 내려요. 콩을 거두면 메주를 쑬 준비를 해요.', ['서리: 추운 밤에 땅이나 풀에 맺힌 얼음 알갱이'], [['🌾', '벼'], ['🫘', '콩'], ['🌶️', '고추'], ['🥬', '배추']]],
      ['겨울 준비', '고추를 말려 고춧가루를 빻고, 무와 배추를 잘 길러 김장을 준비해요. 감이 익으면 홍시로 감식초를 담그기도 해요.', ['가을 → 김장 준비'], '🟠'],
    ], ['가을의 절기', '곡식을 거두는 기쁜 계절이에요 🍂', [['벼랑 콩을 거둬요 🌾', 0], ['서리가 내려요', [['🌾', '벼'], ['🫘', '콩'], ['❄️', '서리']]], ['김장을 준비해요 🥬', 1]]], [F('detail/8970'), E('E0017898')], ['EDU_SEASON_24', 'EDU_JANG_MEJU_TIME']);
    quiz('QZ_SEASON_AUTUMN_1', 'EDU_SEASON_AUTUMN', '첫서리가 내린다는 가을 절기는?', ['상강', '경칩', '소만', '입하'], 0, '상강은 10월 말로, 서리가 내리기 시작하는 때예요.', ['가을에 거두는 것은?', [['🫘', '콩'], ['⛄', '눈사람'], ['🌸', '벚꽃']], 0, '메주의 재료예요 🫘', '맞아요! 콩을 거둬요.']);

    card('EDU_SEASON_WINTER', 'season', '❄️', '겨울의 절기', '입동 무렵 김장을 하고, 동지에는 밤이 가장 길어요. 메주가 겨울을 나요.', [
      ['김장하는 때', '입동(11월 초) 앞뒤에 김장을 해야 제맛이 난다고 했어요. 너무 이르면 김치가 빨리 시고, 너무 늦으면 배추가 얼어요.', ['입동·소설·대설·동지·소한·대한'], [['🥬', '입동 김장'], ['❄️', '소설'], ['🌙', '동지'], ['🧊', '대한']]],
      ['가장 긴 밤', '동지(12월 말)는 일 년 중 밤이 가장 길어요. 이날 팥죽을 쑤어 먹는 풍습이 있어요. 메주는 처마 밑에서 겨울을 나며 단단하게 익어요.', ['동지: 밤이 가장 긴 날'], '🌙'],
    ], ['겨울의 절기', '입동에 김장하고, 동지엔 밤이 가장 길어요 ❄️', [['입동 무렵 김장을 해요 🥬', 0], ['동지는 밤이 가장 길어요', [['🥬', '입동'], ['🌙', '동지'], ['🧊', '대한']]], ['동지에는 팥죽을 먹어요 🥣', 1]]], [E('E0047786'), F('detail/8970')], ['EDU_GIMJANG_DAY', 'EDU_FOLK_DONGJI']);
    quiz('QZ_SEASON_WINTER_1', 'EDU_SEASON_WINTER', '김장을 하기에 알맞다고 한 절기는?', ['입동 무렵', '하지 무렵', '경칩 무렵', '망종 무렵'], 0, '김장은 입동 앞뒤에 해야 제맛이 난다고 했어요.', ['밤이 가장 긴 날은 언제일까요?', [['🌙', '동지'], ['☀️', '하지'], ['🌸', '춘분']], 0, '팥죽을 먹는 날이에요 🥣', '맞아요! 동지예요.']);

    card('EDU_SEASON_FARMYEAR', 'season', '🗓️', '콩 농사 한 해', '봄에 콩을 심고 여름에 김을 매고 가을에 거두면, 겨울에 메주가 되어 이듬해 장이 돼요.', [
      ['씨에서 장까지', '콩은 늦봄(5~6월)에 심어 여름 동안 키우고, 가을(10월)에 거둬요. 거둔 콩으로 입동 무렵 메주를 쑤고, 겨울을 난 메주로 이듬해 봄에 장을 담가요.', ['김매기: 밭의 잡초를 뽑는 일'], [['🌱', '심기'], ['⛏️', '김매기'], ['🫘', '거두기'], ['🧱', '메주'], ['🏺', '장']]],
      ['한 해를 잇는 장', '콩 한 알이 장이 되기까지 거의 한 해가 걸려요. 그래서 장은 한 해 농사와 집안의 정성이 담긴 음식이라고 했어요. 체험관 콩밭에서 직접 길러 봐요.', ['한 해의 정성'], M('bean', '콩')],
    ], ['콩 농사 한 해', '콩 한 알이 장이 되기까지 한 해가 걸려요 🗓️', [['봄에 심고 가을에 거둬요 🌱', 0], ['메주를 만들고 장을 담가요', [['🫘', '콩'], ['🧱', '메주'], ['🏺', '장']]], ['콩밭에서 길러 봐요 🌾', 1]]], [F('메주쑤기'), F('detail/4784')], ['EDU_BEAN', 'EDU_JANG_MEJU_TIME']);
    quiz('QZ_SEASON_FARMYEAR_1', 'EDU_SEASON_FARMYEAR', '콩 농사에서 장이 되기까지의 순서로 알맞은 것은?', ['심기 → 거두기 → 메주 → 장', '장 → 메주 → 심기 → 거두기', '메주 → 심기 → 장 → 거두기', '거두기 → 장 → 심기 → 메주'], 0, '봄에 심어 가을에 거두고, 겨울에 메주를 띄워 이듬해 봄에 장을 담가요.', null);

    // ============================================================ 김장 문화
    card('EDU_GIMJANG_DAY', 'gimjang', '🧑‍🤝‍🧑', '김장하는 날', '겨울을 앞두고 온 가족과 이웃이 모여 한꺼번에 많은 김치를 담가요.', [
      ['함께하는 큰일', '김장 날에는 배추를 절이고 씻고, 소를 만들고 버무리는 일을 여럿이 나눠서 해요. 이웃끼리 돌아가며 서로의 김장을 돕는 것을 ‘품앗이’라고 해요.', ['품앗이: 일을 서로 거들어 주며 갚는 것'], [['🥬', '절이기'], ['💧', '씻기'], ['🌶️', '소 만들기'], ['🖐️', '버무리기'], ['🏺', '담기']]],
      ['김장김치의 종류', '김장 때는 통배추김치뿐 아니라 통무김치, 총각김치, 깍두기, 동치미도 함께 담가요. 고장마다 넣는 재료와 양념이 조금씩 달라요.', ['김장김치 = 겨울 내내 먹을 김치'], M('kimchi', '김장 김치')],
    ], ['김장하는 날', '가족과 이웃이 모여 다 같이 김치를 담가요 🧑‍🤝‍🧑', [['배추를 절이고 씻어요 🥬', 0], ['다 같이 버무려요', [['🥬', '배추'], ['🌶️', '양념'], ['🤝', '함께']]], ['이웃끼리 서로 도와요. 품앗이! 🤝', 1]]], [E('E0047786'), F('김장')], ['EDU_KIMCHI', 'EDU_GIMJANG_UNESCO']);
    quiz('QZ_GIMJANG_DAY_1', 'EDU_GIMJANG_DAY', '이웃끼리 돌아가며 서로의 김장을 돕는 것을 무엇이라고 할까요?', ['품앗이', '줄다리기', '널뛰기', '씨름'], 0, '일을 서로 거들어 주며 갚는 것을 품앗이라고 해요. 김장 때 이웃끼리 돌아가며 도왔어요.', ['김장은 혼자서만 하는 일일까요?', false, '가족과 이웃이 모여요 🧑‍🤝‍🧑', '아니에요! 다 같이 해요.']);

    card('EDU_GIMJANG_UNESCO', 'gimjang', '🌏', '김장 문화, 세계의 유산', '김치를 담그고 나누는 김장 문화는 2013년 유네스코 인류무형문화유산 대표목록에 올랐어요.', [
      ['나눔이 인정받았어요', '2013년 유네스코는 ‘김장, 김치를 담그고 나누는 문화’를 인류무형문화유산 대표목록에 올렸어요. 음식 그 자체보다 함께 담그고 나누는 공동체 문화가 소중하다고 본 거예요.', ['공동체: 함께 사는 사람들의 모임'], '🌏'],
      ['국가무형유산 김치 담그기', '2017년에는 ‘김치 담그기’가 국가무형유산이 되었어요. 집집마다, 고장마다 이어 온 김치 만드는 지식이 함께 지켜지고 있어요.', ['2013 유네스코 · 2017 국가무형유산'], [['🥬', '김치'], ['🤝', '나눔'], ['🌏', '세계 유산']]],
    ], ['김장 문화', '김장은 세계가 아끼는 나눔 문화예요 🌏', [['2013년 세계 유산 목록에 올랐어요', 0], ['함께 담그고 나누는 게 소중해요', [['🥬', '담그기'], ['🤝', '나누기'], ['🌏', '세계']]], ['우리 동네에서도 김장을 나눠요 💞', 1]]], [UN_KIMJANG, E('E0047786'), F('detail/7405')], ['EDU_JANG_UNESCO', 'EDU_GIMJANG_SHARE']);
    quiz('QZ_GIMJANG_UNESCO_1', 'EDU_GIMJANG_UNESCO', '김장 문화가 유네스코 인류무형문화유산 대표목록에 오른 해는?', ['2013년', '2024년', '2001년', '1988년'], 0, '김장 문화는 2013년, 장 담그기 문화는 2024년에 유네스코 대표목록에 올랐어요.', ['김장 문화에서 특히 소중하게 본 것은?', [['🤝', '함께 나누기'], ['💰', '비싸게 팔기'], ['🏃', '빨리 먹기']], 0, '여럿이 함께해요 🤝', '맞아요! 함께 담그고 나누는 거예요.']);

    card('EDU_GIMJANG_STORE', 'gimjang', '🕳️', '김칫독 묻기', '옛날에는 김칫독을 땅에 묻어 겨우내 김치가 얼지도 시지도 않게 보관했어요.', [
      ['땅속은 고른 온도', '겨울에 땅을 파고 김칫독을 묻으면, 땅속은 바깥보다 온도가 고르게 유지돼요. 김치가 얼지 않고 너무 빨리 시지도 않게 천천히 익었어요.', ['땅속 온도는 바깥보다 덜 변해요'], [['⛏️', '땅 파기'], ['🏺', '독 넣기'], ['🌾', '짚 덮기'], ['❄️', '겨울 보관']]],
      ['김치광', '김칫독 위에는 짚으로 엮은 작은 집(김치광)을 지어 눈비를 막기도 했어요. 지금의 김치냉장고는 이 땅속 보관의 지혜를 따라 만든 거예요.', ['김치광: 김칫독을 덮는 짚 움막'], '🏠'],
    ], ['김칫독 묻기', '김칫독을 땅에 묻어 겨울을 나요 🕳️', [['땅을 파고 독을 묻어요 ⛏️', 0], ['땅속은 너무 춥지 않아요', [['⛏️', '파기'], ['🏺', '독'], ['🌾', '짚']]], ['김치냉장고도 이 지혜를 따랐어요 ❄️', 1]]], [F('김장'), E('E0047786')], ['EDU_GIMJANG_DAY', 'EDU_SCI_TEMP']);
    quiz('QZ_GIMJANG_STORE_1', 'EDU_GIMJANG_STORE', '김칫독을 땅에 묻은 까닭으로 알맞은 것은?', ['땅속 온도가 고르게 유지되어서', '김치를 숨기려고', '땅이 김치를 달게 해서', '독을 가볍게 하려고'], 0, '땅속은 바깥보다 온도가 고르게 유지돼서 김치가 얼지도, 빨리 시지도 않아요.', ['김칫독을 땅에 묻으면 김치가 꽁꽁 얼까요?', false, '땅속은 바깥보다 덜 추워요 🕳️', '아니에요! 얼지 않게 지켜 줘요.']);

    card('EDU_GIMJANG_SHARE', 'gimjang', '💞', '나누는 발효 음식', '담근 김치와 장을 이웃과 나누는 것은 오래 이어 온 우리 발효 문화예요.', [
      ['나눔의 문화', '김장을 마치면 김치를 이웃이나 어려운 사람과 나눴어요. 장을 담그면 맛보라고 조금씩 덜어 주기도 했어요. 체험관 장독에서도 다 익은 음식을 ‘나누기’ 할 수 있어요.', ['나누면 정이 쌓여요'], [['🏺', '다 익은 김치'], ['💞', '나누기'], ['🏘️', '이웃']]],
      ['돌아오는 정', '나눔은 서로 돕는 마음을 키워요. 우리 이웃이 김장을 도와주면, 다음에는 내가 이웃의 김장을 도와요. 이렇게 마을이 함께 겨울을 준비했어요.', ['품앗이와 나눔'], '🤝'],
    ], ['나누는 음식', '다 익은 김치를 이웃과 나눠요 💞', [['김장을 마치면 나눠요', 0], ['장독에서 나누기를 해 봐요', [['🏺', '장독'], ['💞', '나누기'], ['🏘️', '이웃']]], ['서로 도우면 마음이 따뜻해져요 🤝', 1]]], [UN_KIMJANG, F('김장')], ['EDU_GIMJANG_UNESCO']);
    quiz('QZ_GIMJANG_SHARE_1', 'EDU_GIMJANG_SHARE', '김장을 마친 뒤 옛사람들이 흔히 한 일은?', ['이웃과 김치를 나눴다', '김치를 모두 버렸다', '김치를 땅에 뿌렸다', '김치를 숨겼다'], 0, '김장을 마치면 김치를 이웃이나 어려운 사람과 나누는 문화가 있었어요.', ['다 익은 김치를 이웃과 나누는 것은 좋은 일이에요. 맞을까요?', true, '마음이 따뜻해져요 💞', '맞아요! 나눔은 우리 문화예요.']);

    // ============================================================ 지역의 장과 김치
    card('EDU_REGION_KIMCHI', 'region', '🗺️', '고장마다 다른 김치', '추운 북쪽은 싱겁고 시원하게, 따뜻한 남쪽은 짜고 맵게 담그는 편이에요.', [
      ['날씨가 맛을 정해요', '추운 북쪽 지방은 김치가 천천히 익어서 소금을 적게 넣고 국물을 넉넉히 해 시원하게 담갔어요. 따뜻한 남쪽은 빨리 익지 않게 소금과 젓갈, 고춧가루를 더 넣어 짜고 맵게 담갔어요.', ['북쪽: 싱겁고 시원하게 · 남쪽: 짜고 맵게'], [['❄️', '북쪽'], ['💧', '시원한 국물'], ['☀️', '남쪽'], ['🌶️', '짭짤 매콤']]],
      ['고장의 재료', '바다가 가까운 곳은 젓갈과 해산물을, 산골은 산나물을 넣었어요. 강원도는 감자를 넣은 열무김치, 여수는 돌산 갓김치처럼 고장마다 이름난 김치가 있어요.', ['고장의 재료가 김치가 돼요'], '🗺️'],
    ], ['고장마다 다른 김치', '추운 곳은 싱겁게, 따뜻한 곳은 짭짤하게 담가요 🗺️', [['날씨에 따라 맛이 달라요', 0], ['북쪽과 남쪽을 비교해요', [['❄️', '시원'], ['☀️', '짭짤'], ['🌶️', '매콤']]], ['고장마다 이름난 김치가 있어요 🍃', 1]]], [F('김장'), E('E0080025')], ['EDU_R_GATKIMCHI', 'EDU_R_YEOLMU']);
    quiz('QZ_REGION_KIMCHI_1', 'EDU_REGION_KIMCHI', '따뜻한 남쪽 지방 김치가 짜고 매운 편인 까닭은?', ['빨리 시지 않게 하려고', '눈이 많이 와서', '배추가 없어서', '물이 귀해서'], 0, '날씨가 따뜻하면 김치가 빨리 익어서, 소금과 젓갈·고춧가루를 더 넣어 짜고 맵게 담갔어요.', ['추운 북쪽 김치는 어떤 편일까요?', [['💧', '싱겁고 시원해요'], ['🔥', '아주 맵고 짜요'], ['🍬', '사탕처럼 달아요']], 0, '국물을 넉넉히 부어요 💧', '맞아요! 싱겁고 시원해요.']);

    card('EDU_REGION_JANG', 'region', '🫘', '고장마다 다른 장', '강원도의 막장, 전라도 순창의 고추장처럼 고장마다 이름난 장이 있어요.', [
      ['고장의 장', '강원도에서는 메줏가루에 보리를 섞은 막장과 가루장을 즐겨 담갔어요. 전라북도 순창은 고추장으로 이름났어요. 고장의 곡물과 날씨가 장맛을 만들어요.', ['순창 고추장 · 강원 막장'], [['⛰️', '강원 막장'], ['🌶️', '순창 고추장'], ['🫘', '집집마다 된장']]],
      ['집집마다 다른 장맛', '같은 고장이라도 집집마다 장맛이 달라요. 메주 띄우는 방법, 소금물의 진하기, 장독대 자리가 조금씩 달라서예요. 그래서 ‘장맛을 보면 그 집 살림을 안다’는 말도 있어요.', ['집집마다 다른 장맛'], M('gochujang', '고추장')],
    ], ['고장마다 다른 장', '고장마다 이름난 장이 있어요 🫘', [['강원도는 막장을 즐겨요 ⛰️', 0], ['순창은 고추장이 유명해요', [['⛰️', '막장'], ['🌶️', '고추장'], ['🟤', '된장']]], ['집집마다 장맛이 달라요 🏠', 1]]], [F('detail/7554'), E('E0016941'), E('E0004012')], ['EDU_R_MAKJANG', 'EDU_GOCHUJANG']);
    quiz('QZ_REGION_JANG_1', 'EDU_REGION_JANG', '메줏가루에 보리를 섞은 막장을 즐겨 담근 고장은?', ['강원도', '제주도', '서울', '울릉도'], 0, '강원도에서는 메줏가루에 보리 같은 곡물을 섞어 빨리 먹는 막장과 가루장을 즐겨 담갔어요.', null);

    card('EDU_REGION_JEOT', 'region', '🌊', '바다마다 다른 젓갈', '서해에서는 새우젓, 남해에서는 멸치젓을 많이 담가요. 젓갈이 다르면 김치 맛도 달라요.', [
      ['서해와 남해', '서해에서는 작은 새우가 많이 잡혀 새우젓을 많이 담갔어요. 남해에서는 봄 멸치로 멸치젓을 담가 김치에 넣었어요. 그래서 고장마다 김치의 감칠맛이 달라요.', ['서해: 새우젓 · 남해: 멸치젓'], [['🦐', '서해 새우젓'], ['🐟', '남해 멸치젓'], ['🥬', '김치 맛']]],
      ['젓갈 장터', '새우젓이 많이 나는 포구에는 큰 젓갈 장터가 열렸어요. 김장철이 되면 사람들이 젓갈을 사러 모여들었어요.', ['포구: 배가 드나드는 바닷가 마을'], '⛵'],
    ], ['바다마다 다른 젓갈', '서쪽 바다는 새우젓, 남쪽 바다는 멸치젓! 🌊', [['서해에는 새우가 많아요 🦐', 0], ['남해에는 멸치가 많아요', [['🦐', '새우젓'], ['🐟', '멸치젓'], ['🥬', '김치']]], ['젓갈이 달라 김치 맛도 달라요 😋', 1]]], [F('새우젓'), N('김장 큐레이션', 'https://www.nongsaro.go.kr/portal/ps/psv/psvr/psvre/curationDtl.ps?menuId=PS03352&srchCurationNo=1080')], ['EDU_R_JEOTGAL']);
    quiz('QZ_REGION_JEOT_1', 'EDU_REGION_JEOT', '남해에서 많이 담가 김치에 넣는 젓갈은?', ['멸치젓', '새우젓만', '조개젓만', '젓갈을 안 쓴다'], 0, '남해에서는 봄 멸치로 담근 멸치젓을 김치에 많이 넣어요. 서해는 새우젓이 많아요.', ['서해에서 많이 담그는 젓갈은?', [['🦐', '새우젓'], ['🐻', '곰젓'], ['🍓', '딸기젓']], 0, '작고 분홍빛인 바다 생물이에요 🦐', '맞아요! 새우젓이에요.']);

    card('EDU_REGION_SIKHAE', 'region', '🍚', '고장마다 다른 식혜', '흔히 아는 단 식혜 말고도, 안동에는 붉은 식혜가 있고 함경도에는 생선 식해가 있어요.', [
      ['안동식혜', '경상북도 안동의 식혜는 밥에 무·고춧가루·생강을 넣고 엿기름물로 삭혀 붉고 새콤달콤해요. 보통 식혜와 이름은 같지만 맛과 모습이 아주 달라요.', ['안동식혜: 무와 고춧가루가 들어간 붉은 식혜'], [['🍚', '밥'], ['🥕', '무'], ['🌶️', '고춧가루'], ['🌱', '엿기름']]],
      ['함경도 식해', '함경도에서는 가자미 같은 생선에 조밥과 엿기름을 넣어 삭힌 식해를 반찬으로 먹었어요. 고장마다 같은 원리로 다른 음식을 만들었어요.', ['같은 원리, 다른 음식'], '🐠'],
    ], ['고장마다 다른 식혜', '안동 식혜는 빨갛고, 함경도 식해는 생선 반찬이에요 🍚', [['안동 식혜는 붉은색이에요 🌶️', 0], ['함경도엔 생선 식해가 있어요', [['🥛', '단 식혜'], ['🌶️', '안동식혜'], ['🐠', '식해']]], ['고장마다 다르게 만들었어요 🗺️', 1]]], [E('E0068243'), N('가자미식해', 'https://www.nongsaro.go.kr/portal/ps/psr/psrc/areaCkRyDtl.ps?menuId=PS03934&cntntsNo=91927')], ['EDU_R_SIKHYE', 'EDU_R_SIKHAE']);
    quiz('QZ_REGION_SIKHAE_1', 'EDU_REGION_SIKHAE', '무와 고춧가루가 들어가 붉은 빛을 띠는 식혜로 이름난 곳은?', ['안동', '제주', '여수', '인천'], 0, '안동식혜는 밥에 무·고춧가루·생강을 넣고 엿기름물로 삭혀 붉고 새콤달콤해요.', ['안동 식혜는 무슨 색일까요?', [['🔴', '붉은색'], ['🟢', '초록색'], ['🔵', '파란색']], 0, '고춧가루가 들어가요 🌶️', '맞아요! 붉은색이에요.']);

    // ============================================================ 도구
    card('EDU_TOOL_KITCHEN', 'tools', '🍳', '부엌의 발효 도구', '가마솥에 콩을 삶고, 체로 거르고, 조리로 쌀을 일었어요.', [
      ['가마솥과 시루', '가마솥은 밥을 짓고 메주콩을 푹 삶는 큰 솥이에요. 시루는 바닥 구멍으로 올라오는 김으로 떡을 쪄요. 증편도 틀에 부어 쪄 냈어요.', ['시루밑: 재료가 빠지지 않게 시루 바닥에 까는 것'], [['🍲', '가마솥'], ['🍡', '시루'], ['♨️', '김']]],
      ['체와 조리', '체는 가루를 치거나 엿기름물 같은 물을 걸러요. 구멍이 굵은 체는 어레미라고 해요. 조리는 쌀을 이는(돌을 골라내는) 도구로, 설날에는 복을 비는 복조리를 걸었어요.', ['일다: 물에 흔들어 돌을 골라내다'], M('tools', '옛 도구')],
    ], ['부엌 도구', '가마솥, 시루, 체, 조리로 요리해요 🍳', [['가마솥에 콩을 삶아요 🍲', 0], ['체로 걸러요', [['🍲', '가마솥'], ['🍡', '시루'], ['🧺', '체']]], ['조리로 쌀 속 돌을 골라요 🍚', 1]]], [E('E0032346'), E('E0051717'), E('E0058685')], ['EDU_TOOLS', 'EDU_HANOK_KITCHEN']);
    quiz('QZ_TOOL_KITCHEN_1', 'EDU_TOOL_KITCHEN', '식혜를 만들 때 엿기름물을 거르는 도구는?', ['체', '호미', '지게', '키'], 0, '체는 가루를 치거나 엿기름물 같은 물을 거르는 도구예요.', ['바닥 구멍으로 올라오는 김으로 떡을 찌는 그릇은?', [['🍡', '시루'], ['🥄', '숟가락'], ['🧺', '바구니']], 0, '떡을 찌는 그릇이에요 ♨️', '맞아요! 시루예요.']);

    card('EDU_TOOL_MEJU', 'tools', '🧱', '메주 도구', '절구로 삶은 콩을 찧고, 메주틀로 네모나게 모양을 잡고, 볏짚으로 묶어 매달아요.', [
      ['찧고 빚기', '삶은 콩은 절구에 넣고 공이로 찧어 으깨요. 으깬 콩을 메주틀에 넣고 꾹꾹 눌러 네모난 메주를 빚어요. 멍석을 펴서 메주를 말리기도 했어요.', ['공이: 절구에 넣어 찧는 방망이', '멍석: 짚으로 엮은 큰 깔개'], [['🥣', '절구'], ['🧱', '메주틀'], ['🌾', '볏짚'], ['🟫', '멍석']]],
      ['볏짚 새끼', '볏짚을 꼬아 만든 새끼줄로 메주를 묶어 매달아요. 볏짚은 메주를 묶는 끈이면서, 고초균을 옮겨 주는 발효의 친구예요.', ['새끼줄: 볏짚을 꼬아 만든 줄'], M('meju', '볏짚으로 묶은 메주')],
    ], ['메주 도구', '절구로 찧고 볏짚으로 묶어요 🧱', [['절구로 콩을 쿵쿵 찧어요 🥣', 0], ['네모나게 빚어요', [['🥣', '절구'], ['🧱', '메주틀'], ['🌾', '볏짚']]], ['볏짚으로 묶어 매달아요 🌾', 1]]], [E('E0049788'), F('메주쑤기'), F('detail/8216')], ['EDU_BEAN', 'EDU_TOOLS']);
    quiz('QZ_TOOL_MEJU_1', 'EDU_TOOL_MEJU', '메주를 묶어 매다는 새끼줄은 무엇으로 꼬아 만들까요?', ['볏짚', '철사', '비닐', '털실'], 0, '볏짚을 꼬아 만든 새끼줄로 메주를 묶어 매달아요. 볏짚은 고초균도 옮겨 줘요.', ['삶은 콩을 찧는 도구는?', [['🥣', '절구'], ['✂️', '가위'], ['🖌️', '붓']], 0, '쿵쿵 찧어요 🥣', '맞아요! 절구예요.']);

    card('EDU_TOOL_YONGSU', 'tools', '🧺', '용수와 소쿠리', '용수는 장이나 술독에 박아 맑은 국물만 떠내는 대나무 통이에요.', [
      ['맑은 국물 떠내기', '용수는 대나무나 싸리로 엮은 길쭉한 통이에요. 장독이나 술독 가운데에 꾹 박으면 그 안으로 맑은 국물만 고여서 떠낼 수 있어요.', ['싸리: 가는 가지가 많은 나무'], [['🧺', '용수 박기'], ['💧', '맑은 국물'], ['🥄', '떠내기']]],
      ['소쿠리와 채반', '소쿠리와 채반은 씻은 채소의 물기를 빼거나 말릴 때 써요. 김장 날 절인 배추를 건져 물을 빼는 데도 꼭 필요했어요.', ['채반: 채소를 말리는 넓은 바구니'], '🧺'],
    ], ['용수와 소쿠리', '용수를 꽂으면 맑은 국물만 고여요 🧺', [['대나무로 엮은 통이에요', 0], ['독에 꽂아 국물을 떠요', [['🧺', '용수'], ['💧', '국물'], ['🥄', '떠내기']]], ['소쿠리로 배추 물기를 빼요 🥬', 1]]], [E('E0039549'), F('김장')], ['EDU_TOOLS', 'EDU_GIMJANG_DAY']);
    quiz('QZ_TOOL_YONGSU_1', 'EDU_TOOL_YONGSU', '장독 가운데에 박아 맑은 국물만 떠내는 대나무 통은?', ['용수', '지게', '맷돌', '호미'], 0, '용수를 장독이나 술독에 박으면 그 안에 맑은 국물만 고여 떠낼 수 있어요.', null);

    card('EDU_TOOL_GEUMJUL', 'tools', '🪢', '금줄과 버선본', '장을 담근 뒤 고추·숯·한지를 끼운 금줄을 두르고, 한지 버선본을 거꾸로 붙이기도 했어요.', [
      ['금줄', '금줄은 볏짚을 왼쪽으로 꼰 새끼줄에 붉은 고추, 숯, 하얀 한지를 끼운 줄이에요. 장독에 두르며 장맛이 변하지 않기를 바랐어요. 아기가 태어난 집 대문에도 금줄을 쳤어요.', ['왼새끼: 보통과 반대로 꼰 새끼줄'], [['🌾', '볏짚'], ['🌶️', '고추'], ['⚫', '숯'], ['📜', '한지']]],
      ['버선본을 거꾸로', '한지로 버선 모양을 오려 장독에 거꾸로 붙이기도 했어요. 나쁜 기운이 버선 속으로 들어가 장에 닿지 않기를 바라는 믿음이에요. 실제로 맛을 바꾸지는 않지만 장을 아끼는 마음이 담겨 있어요.', ['풍습은 마음을 담은 생활 문화예요'], '🧦'],
    ], ['금줄과 버선', '장독에 금줄을 두르고 버선 종이를 붙여요 🪢', [['고추랑 숯을 끼운 줄이에요 🌶️', 0], ['버선 종이를 거꾸로 붙여요', [['🪢', '금줄'], ['🧦', '버선'], ['🏺', '장독']]], ['장을 아끼는 마음이 담겨 있어요 💛', 1]]], [F('금줄'), E('E0076963')], ['EDU_ONGGI_CARE', 'EDU_FOLK_GEUMJUL']);
    quiz('QZ_TOOL_GEUMJUL_1', 'EDU_TOOL_GEUMJUL', '장독에 두르는 금줄에 끼우지 않는 것은?', ['사탕', '붉은 고추', '숯', '한지'], 0, '금줄에는 붉은 고추·숯·한지를 끼워요.', ['금줄을 두르면 장맛이 달라질까요?', false, '마음을 담은 풍습이에요 💛', '아니에요! 맛은 그대로지만 정성이 담겨요.']);

    // ============================================================ 한옥 생활
    card('EDU_HANOK_ONDOL', 'hanok', '🔥', '온돌과 아랫목', '아궁이에 불을 때면 뜨거운 연기가 방바닥 밑을 지나 구들장을 데워요. 불에 가까운 쪽이 아랫목이에요.', [
      ['방바닥 밑 불길', '아궁이의 불기운과 연기가 방바닥 아래 ‘고래’라는 길을 지나 굴뚝으로 나가며 구들장(방바닥 돌)을 데워요. 온돌문화는 2018년 국가무형유산이 되었어요.', ['고래: 방바닥 밑 연기가 지나는 길'], [['🔥', '아궁이'], ['➡️', '고래'], ['🪨', '구들장'], ['🏠', '굴뚝']]],
      ['아랫목의 발효', '아궁이와 가까워 가장 따뜻한 자리를 아랫목이라고 해요. 청국장을 띄우거나 메주를 띄울 때 아랫목에 두고 이불을 덮어 따뜻하게 했어요.', ['아랫목: 불 때는 쪽의 따뜻한 방바닥'], '🛏️'],
    ], ['온돌과 아랫목', '방바닥 밑으로 따뜻한 불기운이 지나가요 🔥', [['아궁이에 불을 때요 🔥', 0], ['불기운이 방바닥을 데워요', [['🔥', '아궁이'], ['🪨', '구들'], ['🏠', '굴뚝']]], ['따뜻한 아랫목에서 청국장을 띄워요 🛏️', 1]]], [E('E0005703'), E('E0077489')], ['EDU_R_CHEONGGUKJANG', 'EDU_HANOK_KITCHEN']);
    quiz('QZ_HANOK_ONDOL_1', 'EDU_HANOK_ONDOL', '아궁이와 가까워 가장 따뜻한 방바닥 자리를 무엇이라 할까요?', ['아랫목', '윗목', '마루', '처마'], 0, '불 때는 아궁이 쪽의 따뜻한 자리를 아랫목, 먼 쪽을 윗목이라고 해요.', ['청국장은 어디에서 띄웠을까요?', [['🛏️', '따뜻한 아랫목'], ['🧊', '얼음 창고'], ['🌊', '바닷가']], 0, '따뜻해야 잘 떠요 🔥', '맞아요! 아랫목이에요.']);

    card('EDU_HANOK_MARU', 'hanok', '🪵', '대청마루', '안방과 건넌방 사이의 넓은 마루예요. 여름엔 시원하고, 집안일을 하는 곳이었어요.', [
      ['넓고 시원한 마루', '대청은 안방과 건넌방 사이에 있는 넓은 나무 마루예요. 여름에는 문을 접어 들어 올려 사방으로 바람이 통하게 했어요. 가족이 모여 쉬고 일하던 곳이에요.', ['들어열개: 접어서 천장에 매다는 문'], '🪵'],
      ['대청에서 하는 일', '대청에서 메주를 빚고, 김장 양념을 다듬고, 다듬이질을 하기도 했어요. 한쪽에는 쌀을 담는 뒤주를 두었어요. 체험관 한옥의 대청에 들어가 봐요.', ['뒤주: 쌀을 넣어 두는 나무 궤'], [['🧱', '메주 빚기'], ['🧄', '양념 다듬기'], ['🍚', '뒤주']]],
    ], ['대청마루', '넓고 시원한 나무 마루예요 🪵', [['여름엔 바람이 솔솔 불어요 🌬️', 0], ['여기서 메주도 빚었어요', [['🪵', '마루'], ['🧱', '메주'], ['🍚', '뒤주']]], ['한옥 대청에 들어가 봐요 🏠', 1]]], [E('E0014835'), E('E0017332')], ['EDU_HANOK_ONDOL', 'EDU_HANOK_JANGDOK']);
    quiz('QZ_HANOK_MARU_1', 'EDU_HANOK_MARU', '안방과 건넌방 사이에 있는 넓은 나무 마루는?', ['대청', '부엌', '곳간', '굴뚝'], 0, '대청은 안방과 건넌방 사이의 넓은 마루로, 가족이 모여 쉬고 일하던 곳이에요.', ['대청마루는 무엇으로 만들었을까요?', [['🪵', '나무'], ['🧊', '얼음'], ['🧱', '벽돌만']], 0, '숲에서 나는 재료예요 🌳', '맞아요! 나무 마루예요.']);

    card('EDU_HANOK_KITCHEN', 'hanok', '🍲', '부엌과 아궁이', '부엌의 아궁이는 밥을 짓고 방을 데우는 두 가지 일을 했어요. 부뚜막에 가마솥을 걸었어요.', [
      ['부뚜막과 가마솥', '부뚜막은 아궁이 위에 흙과 돌로 쌓은 턱이에요. 여기에 가마솥을 걸고 밥을 짓고 메주콩을 삶았어요. 같은 불기운이 방바닥 밑으로 가서 방도 따뜻해졌어요.', ['부뚜막: 솥을 거는 턱'], [['🔥', '아궁이'], ['🍲', '가마솥'], ['🏠', '방 데우기']]],
      ['살강과 물두멍', '부엌 벽에는 그릇을 얹는 선반인 살강이 있었고, 부뚜막 옆에는 물을 담아 두는 큰 항아리 물두멍이 있었어요. 부엌은 발효 음식을 준비하는 곳이기도 했어요.', ['물두멍: 물을 담아 두는 항아리'], '🫙'],
    ], ['부엌과 아궁이', '아궁이 불로 밥도 짓고 방도 데워요 🔥', [['부뚜막에 가마솥을 걸어요 🍲', 0], ['불 하나로 두 가지 일!', [['🔥', '불'], ['🍚', '밥'], ['🏠', '따뜻한 방']]], ['부엌에서 발효 음식을 준비했어요 🫙', 1]]], [E('E0024133'), E('E0034216'), E('E0001673')], ['EDU_HANOK_ONDOL', 'EDU_TOOL_KITCHEN']);
    quiz('QZ_HANOK_KITCHEN_1', 'EDU_HANOK_KITCHEN', '아궁이 불 하나로 한 두 가지 일로 알맞은 것은?', ['밥 짓기와 방 데우기', '빨래와 청소', '모내기와 김매기', '노래와 춤'], 0, '부엌 아궁이의 불로 밥을 짓고, 그 불기운이 방바닥 밑을 지나 방도 데웠어요.', null);

    card('EDU_HANOK_JANGDOK', 'hanok', '🏡', '뒤뜰 장독대와 곳간', '한옥에서는 볕 잘 드는 뒤뜰에 장독대를 두고, 곳간에는 곡식과 살림을 보관했어요.', [
      ['장독대 자리', '장독대는 부엌에서 가깝고 햇볕이 잘 드는 뒤뜰이나 마당 한쪽에 돌로 단을 쌓아 만들었어요. 큰 독은 뒤에, 작은 단지는 앞에 놓아 두세 줄로 정리했어요.', ['단: 땅보다 높게 쌓은 자리'], { type: 'svg', svg: SVG.jangdokdae }],
      ['곳간', '곳간(광)은 쌀·곡식·씨앗과 살림을 넣어 두는 창고예요. 곳간 열쇠는 집안 살림을 맡은 사람이 지녔어요. 체험관 곳간에서도 거둔 작물을 보관해요.', ['곳간: 곡식과 물건을 보관하는 곳'], [['🍚', '쌀'], ['🫘', '콩'], ['🔑', '곳간 열쇠']]],
    ], ['장독대와 곳간', '장독대는 볕 잘 드는 뒤뜰에 있어요 🏡', [['큰 독은 뒤, 작은 단지는 앞에요 🏺', 0], ['곳간에는 곡식을 넣어요', [['🏺', '장독대'], ['🍚', '곳간'], ['🔑', '열쇠']]], ['체험관 곳간에도 가 봐요 🏠', 1]]], [E('E0048394'), E('E0004214')], ['EDU_JANGDOK', 'EDU_HANOK_MARU']);
    quiz('QZ_HANOK_JANGDOK_1', 'EDU_HANOK_JANGDOK', '장독대에 독을 놓는 방법으로 알맞은 것은?', ['큰 독은 뒤에, 작은 단지는 앞에', '작은 단지를 뒤에 숨기고 큰 독을 앞에', '모두 한 줄로 쌓아 올린다', '땅을 파서 모두 묻는다'], 0, '장독대에는 큰 독을 뒤에, 작은 단지를 앞에 두어 두세 줄로 정리했어요. 모두 햇볕을 받을 수 있게요.', ['곡식을 넣어 두는 창고는?', [['🍚', '곳간'], ['🛁', '욕실'], ['🚗', '주차장']], 0, '열쇠로 잠가 두었어요 🔑', '맞아요! 곳간이에요.']);

    // ============================================================ 세시풍속
    card('EDU_FOLK_SEOLLAL', 'folk', '🧧', '설날과 발효 음식', '설날에는 떡국을 먹고, 식혜와 조청을 곁들였어요. 복조리를 걸어 한 해의 복을 빌었어요.', [
      ['설날 상차림', '설날에는 가래떡으로 끓인 떡국을 먹으며 한 살을 더 먹었어요. 단맛 나는 식혜를 마시고, 떡을 조청에 찍어 먹었어요. 나박김치도 상에 올렸어요.', ['가래떡: 길쭉하게 뽑은 흰떡'], [['🍲', '떡국'], ['🥛', '식혜'], ['🍯', '조청'], ['🍲', '나박김치']]],
      ['복조리', '설날 아침에는 쌀을 이는 조리를 벽에 걸어 복을 빌었어요. 조리로 쌀을 건지듯 복을 건지라는 뜻이에요.', ['복조리: 복을 비는 조리'], '🧺'],
    ], ['설날', '떡국 먹고 식혜 마시며 새해를 맞아요 🧧', [['떡국을 먹으면 한 살 더! 🍲', 0], ['식혜랑 조청도 먹어요', [['🍲', '떡국'], ['🥛', '식혜'], ['🍯', '조청']]], ['복조리를 걸어 복을 빌어요 🧺', 1]]], [E('E0051717'), E('E0032592')], ['EDU_R_SIKHYE', 'EDU_R_NABAK']);
    quiz('QZ_FOLK_SEOLLAL_1', 'EDU_FOLK_SEOLLAL', '설날 아침 벽에 걸어 복을 빌던 것은?', ['복조리', '호미', '지게', '키'], 0, '설날 아침에는 조리를 걸어 쌀을 건지듯 복을 건지라고 빌었어요.', ['설날에 먹는 음식은?', [['🍲', '떡국'], ['🍉', '수박'], ['🍦', '아이스크림']], 0, '하얀 떡이 들어간 국이에요 🍲', '맞아요! 떡국이에요.']);

    card('EDU_FOLK_DANO', 'folk', '🌿', '단오', '음력 5월 5일 단오에는 창포물에 머리를 감고, 수리취떡을 먹으며 여름을 맞았어요.', [
      ['여름을 맞는 명절', '단오는 음력 5월 5일로 한 해 중 기운이 가장 좋은 날이라고 여겼어요. 창포를 삶은 물에 머리를 감고, 그네뛰기와 씨름을 하며 놀았어요.', ['창포: 물가에 자라는 향긋한 풀'], [['🌿', '창포물'], ['🎐', '그네'], ['🤼', '씨름']]],
      ['수리취떡과 여름 떡', '단오에는 수리취라는 나물을 넣어 수레바퀴 무늬를 찍은 떡을 먹었어요. 더워지는 여름에는 잘 쉬지 않는 증편 같은 발효 떡도 즐겨 먹었어요.', ['수리: 수레바퀴의 옛말'], '🍡'],
    ], ['단오', '창포물에 머리 감고 그네를 타요 🌿', [['음력 5월 5일이에요', 0], ['그네 타고 씨름해요', [['🌿', '창포'], ['🎐', '그네'], ['🤼', '씨름']]], ['수레바퀴 무늬 떡을 먹어요 🍡', 1]]], [E('E0013638'), F('단오'), F('detail/8052')], ['EDU_R_JEUNGPYEON', 'EDU_SEASON_SUMMER']);
    quiz('QZ_FOLK_DANO_1', 'EDU_FOLK_DANO', '단오에 머리를 감던 물은?', ['창포물', '소금물', '식초물', '간장물'], 0, '단오에는 향긋한 창포를 삶은 물에 머리를 감았어요.', ['단오에 하던 놀이는?', [['🎐', '그네뛰기'], ['⛸️', '스케이트'], ['🎿', '스키']], 0, '하늘 높이 올라가요 🎐', '맞아요! 그네뛰기예요.']);

    card('EDU_FOLK_CHUSEOK', 'folk', '🌕', '추석', '음력 8월 15일 한가위에는 햇곡식으로 송편을 빚고 차례를 지내며 수확에 감사했어요.', [
      ['한가위', '추석은 한가위라고도 해요. 그해 처음 거둔 쌀로 송편을 빚고, 햇과일을 올려 조상께 차례를 지냈어요. 둥근 보름달을 보며 소원을 빌었어요.', ['햇곡식: 그해 처음 거둔 곡식'], [['🌾', '햇곡식'], ['🥟', '송편'], ['🌕', '보름달']]],
      ['솔잎에 찌는 송편', '송편은 솔잎을 깔고 쪄요. 솔잎 향이 배고 떡이 서로 붙지 않아요. 가을 김장 준비도 이 무렵 시작해요.', ['송편 소: 깨·콩·밤 등'], '🌕'],
    ], ['추석', '보름달 보며 송편을 빚어요 🌕', [['햇곡식으로 송편을 빚어요 🥟', 0], ['솔잎을 깔고 쪄요', [['🌾', '쌀'], ['🥟', '송편'], ['🌿', '솔잎']]], ['보름달에 소원을 빌어요 🌕', 1]]], [E('E0057862'), F('추석')], ['EDU_SEASON_AUTUMN']);
    quiz('QZ_FOLK_CHUSEOK_1', 'EDU_FOLK_CHUSEOK', '추석에 송편을 찔 때 까는 것은?', ['솔잎', '볏짚', '한지', '숯'], 0, '송편은 솔잎을 깔고 쪄서 솔향이 배고 서로 붙지 않게 해요.', ['추석에 보는 달은?', [['🌕', '둥근 보름달'], ['🌙', '가는 초승달'], ['🌑', '깜깜한 그믐달']], 0, '아주 동그래요 🌕', '맞아요! 보름달이에요.']);

    card('EDU_FOLK_DONGJI', 'folk', '🥣', '동지 팥죽', '밤이 가장 긴 동지에는 붉은 팥으로 팥죽을 쑤어 먹으며 새해를 기다렸어요.', [
      ['작은 설', '동지는 밤이 가장 긴 날로, 이날부터 낮이 다시 길어져 ‘작은 설’이라고도 했어요. 붉은 팥으로 팥죽을 쑤고 찹쌀 새알심을 넣어 먹었어요.', ['새알심: 찹쌀가루로 빚은 작은 경단'], [['🌙', '긴 밤'], ['🫘', '팥'], ['🥣', '팥죽']]],
      ['붉은색의 믿음', '옛사람들은 붉은 팥이 나쁜 기운을 쫓는다고 믿어 팥죽을 집 안 곳곳에 놓기도 했어요. 장독대에도 놓았다고 해요. 장독 금줄의 붉은 고추처럼 붉은색에 마음을 담았어요.', ['믿음은 마음을 담은 풍습이에요'], '🫘'],
    ], ['동지 팥죽', '밤이 가장 긴 날 팥죽을 먹어요 🥣', [['동지는 밤이 가장 길어요 🌙', 0], ['붉은 팥죽을 쑤어요', [['🫘', '팥'], ['⚪', '새알심'], ['🥣', '팥죽']]], ['붉은색에 좋은 마음을 담았어요 ❤️', 1]]], [E('E0016784'), F('detail/3649')], ['EDU_SEASON_WINTER', 'EDU_TOOL_GEUMJUL']);
    quiz('QZ_FOLK_DONGJI_1', 'EDU_FOLK_DONGJI', '동지에 먹는 음식은?', ['팥죽', '송편', '떡국', '수박화채'], 0, '동지에는 붉은 팥으로 팥죽을 쑤고 새알심을 넣어 먹었어요.', ['동지는 낮이 가장 긴 날일까요?', false, '밤이 가장 길어요 🌙', '아니에요! 밤이 가장 긴 날이에요.']);

    card('EDU_FOLK_GEUMJUL', 'folk', '🎐', '장 담그기 풍습', '장을 담그는 날을 고르고, 금줄을 치고, 버선본을 붙이는 풍습에는 장을 아끼는 마음이 담겨 있어요.', [
      ['장맛은 집안의 자랑', '옛날에는 장맛이 한 해 음식 맛을 좌우한다고 여겼어요. 그래서 장을 담그는 날을 정성껏 고르고, 장독을 깨끗이 닦고, 금줄을 둘러 장을 지켰어요.', ['정성: 온 마음을 다하는 것'], [['📅', '날 고르기'], ['🧽', '닦기'], ['🪢', '금줄']]],
      ['풍습과 과학', '숯은 잡냄새를 빨아들이는 힘이 있어 실제로 도움이 되었어요. 버선본이나 금줄은 맛을 바꾸지는 않지만, 장을 아끼는 마음을 표현한 풍습이에요. 풍습과 과학을 함께 알아 두면 좋아요.', ['숯: 냄새를 빨아들여요 (과학)', '버선본: 마음을 담은 풍습'], '⚫'],
    ], ['장 담그기 풍습', '장을 지키려는 정성이 풍습이 되었어요 🎐', [['좋은 날을 골라 담가요 📅', 0], ['금줄과 버선 종이로 지켜요', [['🪢', '금줄'], ['🧦', '버선'], ['⚫', '숯']]], ['숯은 냄새를 빨아들여요 ⚫', 1]]], [F('금줄'), E('E0076963')], ['EDU_TOOL_GEUMJUL', 'EDU_JANG_DAY']);
    quiz('QZ_FOLK_GEUMJUL_1', 'EDU_FOLK_GEUMJUL', '간장독에 띄우는 것 가운데 잡냄새를 빨아들이는 힘이 있는 것은?', ['숯', '버선본', '꽃잎', '종이배'], 0, '숯은 작은 구멍이 많아 냄새를 빨아들이는 힘이 있어요. 버선본은 마음을 담은 풍습이에요.', null);

    // ============================================================ 정선
    card('EDU_JS_ARIRANG', 'jeongseon', '🎶', '정선아리랑', '강원도 정선의 산과 강에서 불러 온 노래예요. 느릿한 가락에 삶의 이야기가 담겨 있어요.', [
      ['산골의 노래', '정선아리랑은 강원도 정선 사람들이 밭을 매거나 나무를 하며 불러 온 노래예요. 느리고 길게 이어지는 가락에 기쁨과 그리움을 담았어요.', ['가락: 노래의 높낮이와 흐름'], '🎶'],
      ['이어지는 노래', '정선에서는 정선아리랑을 배우고 전하는 모임이 있고, 오일장에서 공연이 열리기도 해요. 노랫말에는 곤드레 같은 정선의 산나물도 나와요.', ['곤드레: 정선 산에서 나는 나물'], [['⛰️', '정선의 산'], ['🎶', '아리랑'], ['🌿', '곤드레']]],
    ], ['정선아리랑', '정선의 산과 강에서 부른 노래예요 🎶', [['밭일하며 노래를 불렀어요 ⛰️', 0], ['느릿느릿 길게 불러요', [['⛰️', '산'], ['🎶', '노래'], ['🌿', '나물']]], ['장터에서 공연도 해요 🎪', 1]]], [F('정선아리랑'), E('E0060065')], ['EDU_JS_MARKET']);
    quiz('QZ_JS_ARIRANG_1', 'EDU_JS_ARIRANG', '정선아리랑은 어느 고장의 노래일까요?', ['강원도 정선', '전라남도 여수', '경상북도 안동', '제주도'], 0, '정선아리랑은 강원도 정선 사람들이 일하며 불러 온 노래예요.', ['정선아리랑은 노래일까요?', true, '가락에 맞춰 불러요 🎶', '맞아요! 정선의 노래예요.']);

    card('EDU_JS_MARKET', 'jeongseon', '🧺', '정선 오일장', '닷새마다 서는 정선 장에는 산나물·곡식·장이 모이고, 아리랑 공연도 열려요.', [
      ['닷새마다 서는 장', '오일장은 닷새에 한 번씩 열리는 시장이에요. 정선 장에는 산에서 캔 나물, 밭에서 거둔 곡식, 집에서 담근 장과 장아찌가 나와요.', ['오일장: 5일마다 열리는 시장'], [['🌿', '산나물'], ['🌽', '옥수수'], ['🫘', '콩'], ['🫙', '장아찌']]],
      ['사람이 모이는 곳', '장날에는 이웃 마을 사람들이 모여 소식을 나누고 물건을 사고팔았어요. 정선 장에서는 정선아리랑 공연도 볼 수 있어요.', ['장터: 장이 서는 곳'], '🎪'],
    ], ['정선 오일장', '닷새마다 서는 시장이에요 🧺', [['5일에 한 번 장이 서요 📅', 0], ['산나물과 곡식이 가득해요', [['🌿', '나물'], ['🌽', '옥수수'], ['🫙', '장']]], ['아리랑 공연도 해요 🎶', 1]]], [F('정선아리랑')], ['EDU_JS_ARIRANG', 'EDU_JS_FOOD']);
    quiz('QZ_JS_MARKET_1', 'EDU_JS_MARKET', '오일장은 며칠마다 열리는 시장일까요?', ['5일', '1일', '30일', '365일'], 0, '오일장은 닷새(5일)에 한 번씩 열리는 시장이에요.', ['오일장은 며칠마다 열릴까요?', [['5️⃣', '5일'], ['1️⃣', '1일'], ['🔟', '10일']], 0, '이름에 숫자가 들어 있어요 🖐️', '맞아요! 5일마다 열려요.']);

    card('EDU_JS_FOOD', 'jeongseon', '🍚', '정선의 맛', '곤드레밥, 옥수수로 만든 올챙이국수, 메밀로 만든 콧등치기 국수가 정선의 음식이에요.', [
      ['산골의 밥상', '곤드레는 고려엉겅퀴라고도 하는 산나물로, 어린잎을 밥에 섞어 곤드레밥을 지었어요. 올챙이국수는 옥수수 녹말 반죽을 구멍으로 내려 올챙이처럼 생겼어요.', ['곤드레: 고려엉겅퀴의 어린잎'], [['🌿', '곤드레밥'], ['🌽', '올챙이국수'], ['🍜', '콧등치기']]],
      ['콧등치기', '콧등치기는 메밀로 만든 국수예요. 면발이 쫄깃해서 후루룩 먹으면 면이 콧등을 친다고 붙은 이름이래요. 막장을 풀어 먹기도 했어요.', ['메밀: 산골에서 잘 자라는 곡식'], '🍜'],
    ], ['정선의 맛', '곤드레밥, 올챙이국수, 콧등치기! 🍚', [['산나물 곤드레로 밥을 지어요 🌿', 0], ['옥수수로 올챙이국수를 만들어요', [['🌿', '곤드레'], ['🌽', '옥수수'], ['🍜', '메밀']]], ['콧등을 치는 국수도 있어요 😆', 1]]], [N('곤드레', 'https://www.nongsaro.go.kr/portal/ps/psr/psrb/monthFdmtDtl.ps?menuId=&cntntsNo=211034'), E('E0050384')], ['EDU_JS_FARM', 'EDU_R_MAKJANG']);
    quiz('QZ_JS_FOOD_1', 'EDU_JS_FOOD', '올챙이국수는 무엇으로 만들까요?', ['옥수수', '밀가루만', '감자만', '찹쌀'], 0, '올챙이국수는 옥수수 녹말 반죽을 구멍으로 내려 만들어요. 모양이 올챙이 같아요.', ['곤드레밥에 넣는 것은?', [['🌿', '산나물 곤드레'], ['🍫', '초콜릿'], ['🧀', '치즈']], 0, '산에서 나는 나물이에요 🌿', '맞아요! 곤드레예요.']);

    card('EDU_JS_FARM', 'jeongseon', '⛰️', '정선의 고랭지 농사', '높은 산골 정선에서는 서늘한 날씨를 살려 감자·옥수수·고랭지 배추를 길러요.', [
      ['높고 서늘한 밭', '고랭지는 높은 곳에 있어 서늘한 땅이에요. 여름에도 시원해서 배추와 무가 잘 자라요. 정선에서는 감자와 옥수수도 많이 길러요. 강원도는 감자·옥수수를 전국에서 가장 많이 길러요.', ['고랭지: 높고 서늘한 땅'], [['⛰️', '높은 밭'], ['🥔', '감자'], ['🌽', '옥수수'], ['🥬', '배추']]],
      ['밭에서 장독까지', '고랭지 배추로 김치를 담그고, 콩으로 메주를 쑤고, 옥수수로 엿을 고았어요. 체험관 텃밭에서 거둔 작물도 장독에서 발효 음식이 돼요.', ['밭 → 장독'], M('cabbage', '배추')],
    ], ['정선의 밭', '높은 산의 밭에서 감자랑 옥수수를 길러요 ⛰️', [['산이 높아 여름에도 시원해요 ⛰️', 0], ['감자, 옥수수, 배추!', [['🥔', '감자'], ['🌽', '옥수수'], ['🥬', '배추']]], ['거둔 작물로 장독에 담가요 🏺', 1]]], [E('E0050384'), E('E0022164')], ['EDU_JS_FOOD', 'EDU_FARMING']);
    quiz('QZ_JS_FARM_1', 'EDU_JS_FARM', '높고 서늘한 땅을 무엇이라 할까요?', ['고랭지', '갯벌', '사막', '평야'], 0, '고랭지는 높은 곳에 있어 서늘한 땅이에요. 여름에도 배추와 무가 잘 자라요.', ['정선에서 많이 기르는 작물은?', [['🥔', '감자'], ['🍍', '파인애플'], ['🥥', '코코넛']], 0, '땅속에서 자라요 🥔', '맞아요! 감자예요.']);

    card('EDU_JS_MANJANG', 'jeongseon', '🏺', '만장대 — 만 개의 장독대', '이 체험관의 만장대는 ‘만 개의 장독대’라는 뜻을 담은 이름이에요. 장을 함께 담그고 지켜요.', [
      ['만 개의 장독', '만장대는 수많은 장독이 모인 장독대라는 뜻을 담고 있어요. 정선에는 전통 장을 담그고 나누는 협동조합이 있고, 씨장을 나누는 일도 하고 있어요.', ['씨장: 맛을 이어 가는 씨앗 같은 장'], '🏺'],
      ['장독 분양', '장독 분양은 봄에 직접 장을 담그면, 마을이 한 해 동안 장독을 돌봐 주고 연말에 장을 받아 가는 방식이에요. 체험관의 만장대 단지에서도 1만 개의 장독과 밭을 살펴볼 수 있어요.', ['분양: 나누어 맡기는 것'], [['🏺', '장 담그기'], ['🧑‍🌾', '마을이 돌봄'], ['🎁', '연말에 받기']]],
    ], ['만장대', '만 개의 장독대라는 뜻이에요 🏺', [['장독이 아주 많이 모여 있어요', 0], ['마을이 장독을 돌봐 줘요', [['🏺', '담그기'], ['🧑‍🌾', '돌보기'], ['🎁', '받기']]], ['만장대 단지에 가 봐요 🚌', 1]]], [{ label: '정선만장대 누리집', url: 'https://www.manjangdae.com/' }, { label: '파주 장독 분양 기사', url: 'https://www.pajuplus.co.kr/news/article.html?no=12402' }], ['EDU_JANG_UNESCO', 'EDU_JS_FARM']);
    quiz('QZ_JS_MANJANG_1', 'EDU_JS_MANJANG', '이 체험관의 ‘만장대’라는 이름에 담긴 뜻은?', ['만 개의 장독대', '아주 높은 산', '큰 강', '넓은 바다'], 0, '만장대는 수많은(만 개의) 장독이 모인 장독대라는 뜻을 담은 이름이에요.', ['만장대에는 장독이 아주 많아요. 맞을까요?', true, '만 개의 장독대예요 🏺', '맞아요! 아주 많아요.']);

    quiz('QZ_JS_FOOD_2', 'EDU_JS_FOOD', '콧등치기 국수는 무엇으로 만들까요?', ['메밀', '쌀', '옥수수', '보리'], 0, '콧등치기는 메밀로 만든 쫄깃한 국수예요. 후루룩 먹으면 면이 콧등을 친다고 붙은 이름이래요.', ['콧등치기는 국수예요. 맞을까요?', true, '후루룩 먹어요 🍜', '맞아요! 메밀 국수예요.']);
    quiz('QZ_SEASON_24_2', 'EDU_SEASON_24', '24절기가 해마다 날짜가 거의 같은 까닭은?', ['해의 움직임을 기준으로 정해서', '달의 모양으로 정해서', '날씨를 보고 정해서', '임금이 날마다 정해서'], 0, '24절기는 해가 지나는 길을 15도씩 나누어 정했기 때문에 해마다 날짜가 거의 같아요.', null);
    quiz('QZ_HANOK_ONDOL_2', 'EDU_HANOK_ONDOL', '아궁이의 연기가 방바닥 밑을 지나가는 길은?', ['고래', '처마', '대청', '살강'], 0, '고래는 방바닥 밑으로 불기운과 연기가 지나 굴뚝으로 나가는 길이에요.', ['방바닥 밑으로 지나가는 것은?', [['🔥', '따뜻한 불기운'], ['💧', '시냇물'], ['🚂', '기차']], 0, '아궁이에서 나와요 🔥', '맞아요! 불기운이 지나가요.']);
    quiz('QZ_ONGGI_KINDS_2', 'EDU_ONGGI_KINDS', '꿀·참기름·장아찌처럼 적은 양을 담아 부엌 가까이 두던 작은 옹기는?', ['단지', '독', '중두리', '시루'], 0, '단지는 목이 짧고 작은 옹기로, 적은 양을 담아 부엌 가까이 두고 썼어요.', null);
    quiz('QZ_GIMJANG_DAY_2', 'EDU_GIMJANG_DAY', '김장 때 통배추김치와 함께 담그는 김치가 아닌 것은?', ['오이소박이', '총각김치', '깍두기', '동치미'], 0, '김장 때는 통배추김치와 통무김치·총각김치·깍두기·동치미를 담가요. 오이소박이는 여름 김치예요.', ['김장은 언제 할까요?', [['❄️', '겨울 오기 전'], ['🌸', '봄꽃 필 때'], ['🏖️', '한여름']], 0, '추워지기 시작할 때예요 ❄️', '맞아요! 겨울 오기 전에 해요.']);
    quiz('QZ_SCI_YEAST_2', 'EDU_SCI_YEAST', '효모가 단맛을 먹고 만드는 것으로 알맞은 것 두 가지는?', ['가스와 알코올', '소금과 물', '흙과 모래', '빛과 소리'], 0, '효모는 당을 먹고 가스와 알코올을 만들어요. 가스는 반죽을 부풀리고, 알코올은 식초의 재료가 되기도 해요.', null);

    // ============================================================ grown-up knowledge (adult: hidden in 쉬운 모드, no quiz)
    card('EDU_ADULT_MAKGEOLLI', 'ferment', '📘', '어른을 위한 지식: 막걸리 빚기', '곡물과 누룩, 물로 빚는 막걸리 빚기는 2021년 국가무형유산이 되었어요. 술은 어른만 마실 수 있어요.', [
      ['곡물·누룩·물', '막걸리는 쌀 같은 곡물을 쪄서 누룩과 물을 섞어 빚어요. 누룩 속 곰팡이가 녹말을 단맛으로, 효모가 그 단맛을 알코올로 바꿔요. 이 지식과 생활 문화가 2021년 6월 15일 국가무형유산 ‘막걸리 빚기’로 지정되었어요.', ['국가무형유산: 나라가 지키는 모양 없는 유산', '체험관에서는 술을 빚거나 마시지 않아요'], [['🍚', '곡물'], ['🟫', '누룩'], ['💧', '물']]],
      ['식초로 이어지는 발효', '체험관 장독대에서는 술 대신 그다음 단계인 식초 발효를 체험해요. 밑술 속 알코올을 초산균이 식초로 바꾸는 과정이에요. 술은 법으로 어른만 마실 수 있어요.', ['어린이는 술을 마시지 않아요'], '📘'],
    ], null, [E('E0079922'), F('누룩')], ['EDU_R_VINEGAR', 'EDU_R_NURUK']);
    NEW.EDU_ADULT_MAKGEOLLI.adult = true;

    // ---------------------------------------------------------------- merge (same normalisation as the contents above)
    for (const [id, e] of Object.entries(NEW)) {
      if (G.data.education[id]) continue;
      e.id = id;
      e.author = AUTHOR;
      e.referenceDate = '2026-11';
      e.verified = false;
      e.color = (G.data.educationCategories[e.cat] || {}).color || '#34c36b';
      e.pages.forEach((p, i) => { p.index = i; });
      e.quiz = e.quizzes[0] || undefined;
      if (!e.kid) delete e.kid;
      G.data.education[id] = e;
    }
    for (const [id, q] of Object.entries(NEWQ)) {
      if (G.data.quizzes[id]) continue;
      q.id = id;
      if (!q.kid) delete q.kid;
      G.data.quizzes[id] = q;
    }
    G.data.educationAdded = { contents: Object.keys(NEW).length, quizzes: Object.keys(NEWQ).length };
  })();

  // [content] ---------------------------------------------------------------- built-in lecture decks (CONTRACT §17.3 / §17.8)
  // G.data.lectureDecks: { id, title, emoji, audience, summary, edu (related content), slides: [{ title, lines, picture?, note? }] }
  // picture = an emoji (the lecture panel draws it big); note = a calm line for the teacher / parent. Text only — no links.
  (function () {
    const S = (title, picture, lines, note) => (note ? { title, picture, lines, note } : { title, picture, lines });
    G.data.lectureDecks = [
      { id: 'DECK_JANG', title: '메주에서 장까지 — 장 담그기의 한 해', emoji: '🫘', audience: 'all', edu: 'EDU_JANG_SPLIT', summary: '콩을 거두어 메주를 쑤고, 장을 담그고, 장 가르기로 간장과 된장을 얻기까지의 한 해를 따라가요.', slides: [
        S('장 담그기의 한 해', '🫘', ['콩 한 알이 장이 되기까지 거의 한 해가 걸려요.', '오늘은 그 길을 차례대로 따라가 봐요.'], '장독대에서 직접 해 볼 수 있는 단계마다 🏺 표시를 해 두었어요.'),
        S('봄: 콩 심기', '🌱', ['늦봄에 밭에 콩을 심어요.', '콩 뿌리의 뿌리혹은 땅을 기름지게 해요.']),
        S('가을: 콩 거두기', '🍂', ['가을에 잘 여문 콩을 거둬요.', '말린 콩을 골라 메주를 쑬 준비를 해요.']),
        S('입동 무렵: 메주 쑤기', '🔥', ['콩을 씻어 하룻밤 불리고 가마솥에 푹 삶아요.', '절구로 찧어 네모나게 빚어요.'], '입동은 11월 초, 겨울이 시작되는 절기예요.'),
        S('메주 띄우기', '🌾', ['메주를 볏짚으로 묶어 매달거나 볏짚 위에서 띄워요.', '볏짚의 고초균과 곰팡이가 메주로 옮겨 가요.']),
        S('정월~삼월: 장 담그는 날', '📅', ['날이 아직 서늘할 때 좋은 날을 골라요.', '깨끗한 독을 볕에 말려 준비해요.']),
        S('소금물 맞추기', '🥚', ['물에 소금을 풀고 달걀을 띄워 봐요.', '달걀이 동전만큼 떠오르면 알맞아요 (18~20도쯤).']),
        S('독에 담그기 🏺', '🏺', ['독에 메주를 넣고 소금물을 부어요.', '숯과 마른 붉은 고추를 띄우고 금줄을 둘러요.'], '체험관 장독에서 ‘장 담그기 (간장·된장)’ 레시피로 해 볼 수 있어요.'),
        S('볕 쬐기와 바람 쐬기 🏺', '☀️', ['맑은 날엔 뚜껑을 열어 햇볕과 바람을 쐬어요.', '비가 오면 얼른 덮어요.']),
        S('40~60일 뒤: 장 가르기 🏺', '✂️', ['메주 건더기를 건져 다른 독에 담아요.', '국물은 간장, 건더기는 된장이 돼요.']),
        S('된장 익히기', '🟤', ['건더기를 치대어 꾹꾹 눌러 담고 웃소금을 뿌려요.', '두세 달 햇볕 아래에서 익혀요.']),
        S('간장 달이기', '🫙', ['국물을 한 번 끓여 식힌 뒤 오래 익혀요.', '묵은 씨간장을 더해 맛을 이어 가기도 해요 (덧장 🏺).']),
        S('세계가 아끼는 장', '🌏', ['장 담그기 문화는 2024년 유네스코 인류무형문화유산이 되었어요.', '메주 하나로 두 가지 장을 얻는 지혜가 담겨 있어요.']),
        S('정리해요', '📝', ['콩 → 메주 → 장 담그기 → 장 가르기 → 간장·된장', '퀴즈로 오늘 배운 것을 확인해 봐요!']),
      ] },
      { id: 'DECK_KIMCHI', title: '김치와 김장 — 함께 담그고 나눠요', emoji: '🥬', audience: 'all', edu: 'EDU_GIMJANG_DAY', summary: '젖산균이 김치를 새콤하게 만드는 과학과, 이웃과 함께 담그고 나누는 김장 문화를 배워요.', slides: [
        S('김치는 발효 음식이에요', '🥬', ['배추와 무를 소금에 절이고 양념에 버무려 익혀요.', '익는 동안 맛이 새콤해져요.']),
        S('새콤함의 주인공, 젖산균', '🦠', ['젖산균이 채소의 단맛을 먹고 젖산을 만들어요.', '젖산이 많아지면 다른 균이 잘 자라지 못해요.']),
        S('온도가 중요해요', '🌡️', ['서늘하면 천천히, 따뜻하면 빨리 익어요.', '여름 김치는 조금씩, 겨울 김치는 넉넉히 담가요.']),
        S('김장은 언제?', '❄️', ['입동 앞뒤에 김장을 해요.', '너무 이르면 빨리 시고, 늦으면 배추가 얼어요.']),
        S('배추 절이기', '🧂', ['배추를 반으로 갈라 소금물에 하룻밤 절여요.', '숨이 죽으면 깨끗이 씻어 물기를 빼요.']),
        S('김칫소 만들기', '🌶️', ['고춧가루·마늘·생강·젓갈·무채를 버무려요.', '고장마다 넣는 재료가 조금씩 달라요.']),
        S('다 같이 버무려요', '🧑‍🤝‍🧑', ['가족과 이웃이 모여 일을 나눠요.', '서로의 김장을 돕는 것을 품앗이라고 해요.']),
        S('김장 때 담그는 김치', '🥕', ['통배추김치, 총각김치, 깍두기, 동치미', '체험관 장독에서도 담가 볼 수 있어요 🏺']),
        S('김칫독 묻기', '🕳️', ['땅속은 온도가 고르게 유지돼요.', '김치가 얼지도 빨리 시지도 않아요.']),
        S('고장마다 다른 김치', '🗺️', ['추운 북쪽은 싱겁고 시원하게, 따뜻한 남쪽은 짜고 맵게', '여수 돌산 갓김치, 강원도 감자 열무김치']),
        S('세계가 아끼는 김장', '🌏', ['김장 문화는 2013년 유네스코 인류무형문화유산이 되었어요.', '함께 담그고 나누는 마음이 소중하다고 보았어요.']),
        S('정리해요', '📝', ['젖산균 · 입동 · 품앗이 · 나눔', '장독에서 다 익은 김치를 ‘나누기’ 해 봐요 💞']),
      ] },
      { id: 'DECK_MICROBES', title: '발효를 일으키는 작은 친구들', emoji: '🔬', audience: 'all', edu: 'EDU_SCI_MICROBES', summary: '곰팡이·효모·세균, 그리고 효소가 음식을 어떻게 바꾸는지 그림으로 알아봐요.', slides: [
        S('발효란 무엇일까요?', '🧫', ['미생물이 음식 성분을 바꿔 새로운 맛과 향을 만드는 일이에요.', '먹기 좋게 바뀌면 발효, 상하면 부패예요.']),
        S('눈에 안 보이는 크기', '🔬', ['세균은 머리카락 굵기보다 수십 배 작아요.', '현미경으로만 볼 수 있어요.']),
        S('곰팡이', '🍄', ['실처럼 뻗어 자라요.', '메주와 누룩에서 녹말과 단백질을 나누는 효소를 만들어요.']),
        S('효모', '🫧', ['동그란 모양이에요.', '단맛을 먹고 가스와 알코올을 만들어요. 증편을 부풀려요.']),
        S('세균: 젖산균', '🥬', ['김치를 새콤하게 해요.', '서늘할 때 천천히 일해요.']),
        S('세균: 고초균', '🌾', ['볏짚에 살아요.', '메주와 청국장에서 구수한 맛을 만들어요.']),
        S('세균: 초산균', '🍶', ['공기를 좋아해요.', '알코올을 초산으로 바꿔 식초를 만들어요.']),
        S('효소는 가위예요', '✂️', ['효소는 살아 있지 않지만 성분을 잘게 잘라요.', '엿기름 효소가 밥을 달게 해요 (식혜).']),
        S('소금의 힘', '🧂', ['상하게 하는 균을 막아요.', '너무 적어도, 너무 많아도 안 돼요.']),
        S('온도와 기다림', '⏳', ['음식마다 좋아하는 온도가 달라요.', '청국장 40℃쯤 · 식초 25~30℃ · 김치 4~15℃']),
        S('정리해요', '📝', ['곰팡이 · 효모 · 젖산균 · 고초균 · 초산균 · 효소', '장독 창에서 미생물이 하는 일을 다시 읽어 봐요.']),
      ] },
      { id: 'DECK_ONGGI', title: '옹기와 장독대', emoji: '🏺', audience: 'all', edu: 'EDU_ONGGI_BREATH', summary: '흙으로 빚어 구운 옹기가 왜 숨 쉬는 그릇인지, 장독대는 어떻게 꾸렸는지 알아봐요.', slides: [
        S('옹기는 무엇일까요?', '🏺', ['흙으로 빚어 잿물을 입히고 가마에서 구운 그릇이에요.', '장과 김치, 곡식을 담았어요.']),
        S('옹기 만들기', '🔄', ['흙가래를 물레 위에서 쌓아 올려요.', '안팎을 두드려 단단하게 빚어요.']),
        S('잿물과 가마', '🔥', ['나뭇재로 만든 잿물을 입혀요.', '가마에서 높은 불로 오래 구워요.']),
        S('숨 쉬는 그릇', '🌬️', ['구울 때 흙 속 물기가 빠지며 아주 작은 구멍이 생겨요.', '공기가 조금씩 드나들어 장이 알맞게 익어요.']),
        S('옹기의 이름', '📏', ['독 · 중두리 · 항아리 · 단지', '크기와 모양에 따라 담는 것이 달라요.']),
        S('고장마다 다른 모양', '🗺️', ['추운 고장은 입이 넓고, 더운 고장은 입이 좁았다고 해요.', '모양 속에 날씨의 지혜가 있어요.']),
        S('장독대 자리', '☀️', ['볕 잘 들고 바람 잘 통하는 곳', '땅보다 높게 돌로 단을 쌓아요.']),
        S('장독 놓는 법', '🏺', ['큰 독은 뒤에, 작은 단지는 앞에', '두세 줄로 정리해요.']),
        S('장독 돌보기', '🧽', ['자주 닦고, 맑은 날 뚜껑을 열고, 비 오면 덮어요.', '웃소금을 뿌려 곰팡이를 막아요.']),
        S('금줄과 버선본', '🪢', ['고추·숯·한지를 끼운 금줄을 둘러요.', '맛을 바꾸지는 않지만 정성이 담긴 풍습이에요.']),
        S('정리해요', '📝', ['체험관 장독 12개도 독·중두리·항아리·단지예요.', '레시피가 좋아하는 옹기를 골라 담가 봐요!']),
      ] },
      { id: 'DECK_SEASONS', title: '24절기와 우리 농사', emoji: '🌞', audience: 'all', edu: 'EDU_SEASON_24', summary: '해를 보고 만든 24절기 달력으로 씨 뿌리고 거두고, 장과 김치를 담그던 때를 알아봐요.', slides: [
        S('24절기란?', '🌞', ['해가 지나는 길을 15도씩 나눈 24개의 날이에요.', '해마다 날짜가 거의 같아요.']),
        S('봄을 여는 입춘', '🌱', ['2월 초, 봄이 시작돼요.', '대문에 봄을 반기는 글을 붙였어요.']),
        S('개구리가 깨는 경칩', '🐸', ['3월 초, 겨울잠 자던 개구리가 깨어나요.']),
        S('봄비 내리는 곡우', '🌧️', ['4월 말, 곡식을 기르는 비가 와요.', '볍씨를 뿌리고 밭에 씨를 심어요.']),
        S('바쁜 망종', '🌾', ['6월 초, 보리를 베고 모를 내요.']),
        S('낮이 가장 긴 하지', '☀️', ['6월 말, 일 년 중 낮이 가장 길어요.', '여름엔 김치가 빨리 익어요.']),
        S('거두는 추분', '🍂', ['9월 말, 낮과 밤의 길이가 같아요.', '벼와 콩, 고추를 거둬요.']),
        S('서리 내리는 상강', '❄️', ['10월 말, 첫서리가 내려요.', '김장 준비를 시작해요.']),
        S('김장하는 입동', '🥬', ['11월 초, 겨울이 시작돼요.', '김장을 하고 메주를 쑤어요.']),
        S('밤이 가장 긴 동지', '🌙', ['12월 말, 팥죽을 쑤어 먹어요.', '작은 설이라고도 했어요.']),
        S('체험관도 한국의 계절로', '🗓️', ['체험관의 작물과 날씨는 한국의 시간과 계절을 따라요.', '절기에 맞는 작물을 길러 봐요.']),
        S('정리해요', '📝', ['입춘 · 경칩 · 곡우 · 망종 · 하지 · 추분 · 상강 · 입동 · 동지', '절기 퀴즈에 도전해 봐요!']),
      ] },
      { id: 'DECK_JEONGSEON', title: '정선과 만장대', emoji: '⛰️', audience: 'all', edu: 'EDU_JS_MANJANG', summary: '높은 산골 정선의 노래와 장터, 음식과 농사, 그리고 만 개의 장독대 만장대를 소개해요.', slides: [
        S('강원도 정선', '⛰️', ['높은 산과 맑은 강이 흐르는 고장이에요.', '여름에도 서늘한 고랭지 밭이 많아요.']),
        S('정선아리랑', '🎶', ['밭을 매고 나무를 하며 부른 노래예요.', '느리고 길게 이어지는 가락이에요.']),
        S('정선 오일장', '🧺', ['닷새마다 장이 서요.', '산나물·곡식·장이 모이고 아리랑 공연도 열려요.']),
        S('고랭지 농사', '🥔', ['감자·옥수수·배추를 많이 길러요.', '강원도는 감자와 옥수수를 가장 많이 길러요.']),
        S('곤드레밥', '🌿', ['산나물 곤드레의 어린잎을 밥에 섞어 지어요.']),
        S('올챙이국수와 콧등치기', '🍜', ['올챙이국수는 옥수수로, 콧등치기는 메밀로 만들어요.']),
        S('강원도의 막장', '🟫', ['메줏가루에 보리를 섞어 빨리 익혀요.', '된장보다 달큰해요.']),
        S('만장대', '🏺', ['‘만 개의 장독대’라는 뜻을 담은 이름이에요.', '장을 함께 담그고 지키는 곳이에요.']),
        S('장독 분양', '🤝', ['봄에 장을 담그면 마을이 한 해 동안 돌봐 줘요.', '체험관의 만장대 단지에 1만 개의 장독과 밭이 있어요.']),
        S('정리해요', '📝', ['정선아리랑 · 오일장 · 고랭지 · 곤드레 · 막장 · 만장대', '셔틀버스를 타고 만장대 단지에 가 봐요 🚌']),
      ] },
      { id: 'DECK_SWEET', title: '식혜·조청·증편 — 효소와 효모의 맛', emoji: '🍯', audience: 'all', edu: 'EDU_R_SIKHYE', summary: '엿기름 속 효소가 만드는 단맛과, 효모가 부풀리는 떡을 알아봐요.', slides: [
        S('단맛은 어디서 올까요?', '🍚', ['쌀과 보리의 녹말은 원래 달지 않아요.', '녹말이 잘게 잘리면 단맛이 나요.']),
        S('엿기름', '🌱', ['보리에 싹을 틔워 말린 가루예요.', '싹 속에 녹말을 자르는 효소가 있어요.']),
        S('식혜 만들기', '🥛', ['엿기름물을 밥에 붓고 60~70℃쯤으로 4~5시간 두어요.', '밥알이 동동 뜨면 다 됐어요.']),
        S('당화', '✂️', ['효소가 녹말을 단맛 나는 당으로 바꾸는 일이에요.', '식혜는 미생물이 아니라 효소가 일해요.']),
        S('조청과 엿', '🍯', ['삭힌 단물을 오래 졸이면 조청, 더 고면 엿이 돼요.', '오래 졸일수록 색이 짙어져요.']),
        S('강원도 옥수수엿', '🌽', ['밭에서 거둔 옥수수로도 엿을 고아요.']),
        S('증편', '🍡', ['쌀가루 반죽을 효모로 부풀려 쪄요.', '새콤한 맛 덕분에 여름에도 잘 쉬지 않아요.']),
        S('효모와 효소의 차이', '⚖️', ['효모는 살아 있는 미생물, 효소는 미생물이 만든 물질이에요.', '효모는 부풀리고, 효소는 잘라요.']),
        S('설날의 단맛', '🧧', ['설날에는 식혜를 마시고 떡을 조청에 찍어 먹었어요.']),
        S('정리해요', '📝', ['엿기름 · 당화 · 조청 · 효모 · 증편', '장독에서 식혜와 조청을 만들어 봐요 🏺']),
      ] },
    ];
  })();
})();
