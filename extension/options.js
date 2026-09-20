const endpoint = document.getElementById('endpoint')
const token = document.getElementById('token')
const config = document.getElementById('config')
const status = document.getElementById('status')

function show(message, error = false) {
  status.textContent = ` ${message}`
  status.style.color = error ? '#b42318' : ''
}

function save() {
  const endpointValue = endpoint.value.trim()
  const tokenValue = token.value.trim()
  if (!/^http:\/\/127\.0\.0\.1:\d+\/media$/i.test(endpointValue) || tokenValue.length < 32) {
    show('Enter the endpoint and token shown by TurboDownload.', true)
    return
  }
  chrome.storage.local.set({ endpoint: endpointValue, token: tokenValue }, () => show('Connected. Play a direct video to detect it.'))
}

chrome.storage.local.get(['endpoint', 'token'], (stored) => {
  endpoint.value = stored.endpoint || ''
  token.value = stored.token || ''
})

document.getElementById('connect').addEventListener('click', () => {
  try {
    const parsed = JSON.parse(config.value)
    endpoint.value = typeof parsed.endpoint === 'string' ? parsed.endpoint : ''
    token.value = typeof parsed.token === 'string' ? parsed.token : ''
    save()
  } catch {
    show('The copied config is not valid JSON. Copy it again from TurboDownload Settings.', true)
  }
})

document.getElementById('save').addEventListener('click', save)
