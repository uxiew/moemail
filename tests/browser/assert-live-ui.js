(() => {
  const assert = (ok, message) => { if (!ok) throw new Error(message) }
  const visible = node => node.getBoundingClientRect().width > 0
  const result = { route: location.pathname, width: innerWidth, height: innerHeight }
  assert(document.documentElement.scrollWidth <= innerWidth, 'Page has horizontal overflow')
  if (location.pathname.endsWith('/login')) {
    assert(document.querySelectorAll('input[placeholder="用户名"]').length === 1, 'Login form is missing or duplicated')
    const inputs = [...document.querySelectorAll('input')]
    const rects = inputs.map(input => input.getBoundingClientRect())
    assert(rects.length >= 2, 'Login fields did not mount')
    assert(rects.every(rect => Math.abs(rect.x - rects[0].x) < 1 && Math.abs(rect.width - rects[0].width) < 1), 'Login fields are misaligned')
    assert(document.documentElement.scrollHeight <= innerHeight, 'Login page has an unexpected second screen')
  } else {
    assert(!document.querySelector('input[placeholder="用户名"]'), 'Global login form leaked into another page')
  }
  if (/^\/zh-CN\/?$/.test(location.pathname)) {
    const hero = document.querySelector('main > div')?.getBoundingClientRect()
    const title = document.querySelector('main h1')?.getBoundingClientRect()
    const action = document.querySelector('main button')?.getBoundingClientRect()
    assert(hero && title && action && title.top >= hero.top && action.bottom <= hero.bottom, 'Home title or action is clipped on a small screen')
  }
  if (location.pathname.endsWith('/moe')) {
    assert(document.documentElement.scrollHeight <= innerHeight, 'Mailbox page scrolls outside its panels')
    const headings = [...document.querySelectorAll('main h2')].filter(visible)
    if (innerWidth >= 1024) {
      assert(headings.length === 3, 'Desktop mailbox must mount three columns')
      const rects = headings.map(heading => heading.parentElement.getBoundingClientRect())
      assert(rects.every(rect => rect.height === 56 && rect.y === rects[0].y), 'Column headers are misaligned')
    }
  }
  if (location.pathname.includes('/shared/')) {
    assert(document.querySelectorAll('iframe').length <= 1, 'Hidden shared detail is still mounted')
    for (const label of [...document.querySelectorAll('label')].filter(visible)) {
      if (label.control) assert(visible(label.control), 'Label targets a hidden layout control')
    }
  }
  const configFields = [...document.querySelectorAll('input[id^="website-"]')]
  if (configFields.length) {
    const rects = configFields.map(input => input.getBoundingClientRect())
    assert(rects.every(rect => Math.abs(rect.x - rects[0].x) < 1 && Math.abs(rect.width - rects[0].width) < 1), 'Settings fields are misaligned')
    assert(document.querySelector('#registration-enabled'), 'Registration switch is missing')
  }
  for (const frame of [...document.querySelectorAll('iframe')].filter(visible)) {
    assert(!frame.sandbox.contains('allow-scripts'), 'Email scripts must stay sandboxed')
    assert(frame.contentDocument?.body?.innerText.trim(), 'Email body is blank')
    assert(frame.contentDocument.documentElement.scrollWidth <= frame.clientWidth, 'Sample email overflows horizontally')
  }
  return { ...result, pass: true }
})()
