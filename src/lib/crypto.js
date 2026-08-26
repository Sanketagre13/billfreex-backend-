import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

/**
 * Encrypts a UTF-8 string at rest (PAN numbers, full CRIF report bodies).
 * Layout: iv (12B) || authTag (16B) || ciphertext, all in one Buffer — self
 * describing, so decrypt() needs nothing but the key.
 */
export function encrypt(plaintext) {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, config.encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext])
}

export function decrypt(buffer) {
  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = buffer.subarray(IV_LENGTH + 16)

  const decipher = createDecipheriv(ALGORITHM, config.encryptionKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
