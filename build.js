#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { execSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import pkg from './package.json' assert { type: 'json' }
import { resolve } from 'node:path'

const nanoid = () => Math.random().toString(36).slice(2)

const cleanDir = dir => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

const argv = () => {
  const parse = config => {
    try {
      return parseArgs(config)
    } catch (err) {
      console.error(err.message)
      process.exit(1)
    }
  }

  const { values, positionals } = parse({
    allowPositionals: true,
    options: {
      base: { type: 'string', short: 'b' },
      output: { type: 'string', short: 'o', default: 'output' },
      segment: { type: 'string', short: 's', default: '30' },
      watermark: { type: 'string', short: 'w' },
      overlay: { type: 'string', default: '1780:940' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false }
    }
  })

  if (values.version) {
    console.log(`${pkg.name}/${pkg.version}`)
    process.exit(0)
  }

  if (values.help) {
    console.log(`
${pkg.name}/${pkg.version}

Usage:
  $ zvdo <cwd> [params] [options]

Arguments:
  cwd   Current working directory, default is \`process.cwd()\`

Options:
  -b, --base           Base URL for m3u8 files
  -o, --output         Output directory for m3u8 files
  -s, --segment        Segment time for m3u8 files, default is 30
  -w, --watermark      Watermark image path
  --overlay            Overlay position for watermark, default is 1780:940
  -h, --help           Display this message
  -v, --version        Display version number
`)
    process.exit(0)
  }

  if (values.base == null) {
    console.error('Missing base URL')
    process.exit(1)
  }

  const segment = parseInt(values.segment)

  if (isNaN(segment) || segment <= 0) {
    console.error('Invalid segment time')
    process.exit(1)
  }

  const cwd = positionals[0] || process.cwd()
  const baseUrl = values.base
  const output = resolve(cwd, values.output)
  const watermark = values.watermark && resolve(cwd, values.watermark)
  const overlay = values.overlay

  if (!statSync(cwd).isDirectory()) {
    console.error(`${cwd} is not a directory`)
    process.exit(1)
  }
  return { cwd, output, baseUrl, segment, watermark, overlay }
}

const loadFiles = dir => {
  const files = readdirSync(dir)
    .filter(file => file.endsWith('.mp4'))
    .sort((a, b) => a.localeCompare(b))

  if (files.length === 0) {
    console.error(`No mp4 files found in ${dir}`)
    process.exit(1)
  }
  return files
}

const { cwd, output, baseUrl, segment, watermark, overlay } = argv()

cleanDir(output)

const files = loadFiles(cwd)

const sections = []

for (const file of files) {
  const [idx, name] = file.split('-')
  const id = nanoid()
  const title = name.replace(/\.mp4$/, '')
  const slug = `v${idx.padStart(2, '0')}`
  const description = title
  const duration = ~~execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`, { cwd }).toString().trim()
  const source = `${baseUrl}${id}.m3u8`
  const watermarkArgs = watermark ? `-i "${watermark}" -filter_complex "overlay=${overlay}" -c:v h264_nvenc -c:a aac` : '-c copy'
  const m3u8Args = `-map 0 -f segment -segment_time ${segment} -segment_list "${output}/${id}.m3u8" -segment_format mpegts "${output}/${id}-%03d.ts"`
  execSync(`ffmpeg -i "${file}" ${watermarkArgs} ${m3u8Args}`, { cwd })
  sections.push(`
  - title: ${title}
    slug: ${slug}
    description: ${description}
    duration: ${duration}
    source: ${source}`)
}

writeFileSync(`${output}/_playlist.yml`, `sections:${sections.join('')}`)
