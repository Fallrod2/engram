// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Dropzone, hasAcceptedExtension, isImageFile } from './dropzone'

afterEach(cleanup)

describe('dropzone helpers', () => {
  it('isImageFile detects photo extensions only', () => {
    expect(isImageFile('cours.jpg')).toBe(true)
    expect(isImageFile('cours.JPEG')).toBe(true)
    expect(isImageFile('scan.png')).toBe(true)
    expect(isImageFile('shot.webp')).toBe(true)
    expect(isImageFile('notes.md')).toBe(false)
    expect(isImageFile('notes.pdf')).toBe(false)
  })

  it('hasAcceptedExtension now accepts images alongside docs', () => {
    expect(hasAcceptedExtension('a.png')).toBe(true)
    expect(hasAcceptedExtension('a.pdf')).toBe(true)
    expect(hasAcceptedExtension('a.heic')).toBe(false)
  })
})

describe('<Dropzone>', () => {
  it('offers a distinct rear-camera capture input for mobile', () => {
    const { container } = render(<Dropzone onFiles={vi.fn()} />)
    const inputs = Array.from(container.querySelectorAll('input[type="file"]'))
    const camera = inputs.find((el) => el.getAttribute('capture') === 'environment')
    expect(camera).toBeTruthy()
    expect(camera!.getAttribute('accept')).toBe('image/*')
    expect(screen.getByRole('button', { name: 'Prendre une photo' })).toBeTruthy()
  })

  it('the file picker accepts photo extensions', () => {
    const { container } = render(<Dropzone onFiles={vi.fn()} />)
    const picker = Array.from(container.querySelectorAll('input[type="file"]')).find(
      (el) => el.getAttribute('capture') === null,
    )
    expect(picker!.getAttribute('accept')).toContain('.png')
    expect(picker!.getAttribute('accept')).toContain('.jpg')
  })

  it('passes selected files straight through to onFiles', () => {
    const onFiles = vi.fn()
    const { container } = render(<Dropzone onFiles={onFiles} />)
    const picker = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ).find((el) => el.getAttribute('capture') === null)!
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(picker, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledTimes(1)
    const passed = onFiles.mock.calls[0]![0] as File[]
    expect(passed[0]!.name).toBe('a.png')
  })
})
