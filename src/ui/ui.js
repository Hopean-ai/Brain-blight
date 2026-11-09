'use strict';

const $ = (id) => document.getElementById(id);
const api = window.bb;

$('next').onclick = () => api.next();
$('mute').onclick = () => api.mute();
$('login').onclick = () => api.login();
$('setup-next').onclick = () => api.setupNext();
$('setup-back').onclick = () => api.setupBack();
$('setup-finish').onclick = () => api.setupFinish();

function render(s) {
  const setup = s.mode === 'setup';
  $('feed').hidden = setup;
  $('setup').hidden = !setup;

  const pills = $('pills');
  pills.replaceChildren(
    ...s.platforms.map((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.className = i === s.active ? 'active' : '';
      b.onclick = () => api.select(i);
      return b;
    }),
  );

  $('mute').textContent = s.muted ? '🔇' : '🔊';
  $('notice').hidden = !s.notice;
  $('notice').textContent = s.notice || '';
  $('notice').title = s.notice || '';

  if (setup) {
    const p = s.platforms[s.setupIndex];
    const last = s.setupIndex >= s.platforms.length - 1;
    $('setup-text').innerHTML = '';
    const b = document.createElement('b');
    b.textContent = p ? p.name : '';
    $('setup-text').append(
      `Log in to `,
      b,
      ` (${s.setupIndex + 1}/${s.platforms.length}), or skip.`,
    );
    $('setup-back').disabled = s.setupIndex === 0;
    $('setup-next').textContent = last ? 'Start watching' : 'Next';
    $('setup-finish').hidden = last;
  }
}

api.onState(render);
api.ready();
