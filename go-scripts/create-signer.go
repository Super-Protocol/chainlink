package main

import (
	"crypto/aes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/crypto/curve25519"
)

const SharedSecretSize = 16 // 128-bit symmetric key

type SharedSecretEncryptionPublicKey [curve25519.PointSize]byte

type encryptedSharedSecret [SharedSecretSize]byte

type SharedSecretEncryptions struct {
	// (secret key chosen by dealer) * g, X25519 point
	DiffieHellmanPoint [curve25519.PointSize]byte

	// keccak256 of plaintext sharedSecret
	SharedSecretHash common.Hash

	// Encryptions of the shared secret with one entry for each oracle
	Encryptions []encryptedSharedSecret
}

// Encrypt one block with AES-128
func aesEncryptBlock(key, plaintext []byte) [16]byte {
	if len(key) != 16 {
		panic("key has wrong length")
	}
	if len(plaintext) != 16 {
		panic("plaintext has wrong length")
	}

	cipher, err := aes.NewCipher(key)
	if err != nil {
		panic(fmt.Sprintf("Unexpected error during aes.NewCipher: %v", err))
	}

	var ciphertext [16]byte
	cipher.Encrypt(ciphertext[:], plaintext)
	return ciphertext
}

// EncryptSharedSecret creates SharedSecretEncryptions from a set of public keys and a shared secret
func EncryptSharedSecret(
	publicKeys []SharedSecretEncryptionPublicKey,
	sharedSecret *[SharedSecretSize]byte,
	rand io.Reader,
) SharedSecretEncryptions {
	// Generate ephemeral secret key
	var sk [32]byte
	_, err := io.ReadFull(rand, sk[:])
	if err != nil {
		panic(fmt.Sprintf("could not produce entropy for encryption: %v", err))
	}

	// Generate public key from ephemeral secret key
	pk, err := curve25519.X25519(sk[:], curve25519.Basepoint)
	if err != nil {
		panic(fmt.Sprintf("while encrypting sharedSecret: %v", err))
	}

	var pkArray [32]byte
	copy(pkArray[:], pk)

	// Encrypt shared secret for each public key
	encryptedSharedSecrets := []encryptedSharedSecret{}
	for _, publicKey := range publicKeys {
		pkBytes := [32]byte(publicKey)

		// Perform Diffie-Hellman key exchange
		dhPoint, err := curve25519.X25519(sk[:], pkBytes[:])
		if err != nil {
			panic(fmt.Sprintf("while encrypting sharedSecret: %v", err))
		}

		// Derive AES key from DH point
		key := crypto.Keccak256(dhPoint)[:16]

		// Encrypt shared secret with AES-128
		encryptedSharedSecret := encryptedSharedSecret(aesEncryptBlock(key, sharedSecret[:]))
		encryptedSharedSecrets = append(encryptedSharedSecrets, encryptedSharedSecret)
	}

	return SharedSecretEncryptions{
		DiffieHellmanPoint: pkArray,
		SharedSecretHash:   common.BytesToHash(crypto.Keccak256(sharedSecret[:])),
		Encryptions:        encryptedSharedSecrets,
	}
}

func main() {
	// Создаем или генерируем общий секрет (16 байт)
	sharedSecret := [SharedSecretSize]byte{
		0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
		0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
	}

	// Либо генерируем случайный секрет:
	// var sharedSecret [SharedSecretSize]byte
	// _, err := io.ReadFull(rand.Reader, sharedSecret[:])
	// if err != nil {
	//     panic(err)
	// }

	// Массив публичных ключей
	publicKeyHexes := []string{
		"8c73c450b5bde91f441fba73a08115ac40cec7409fdcd5e5c2aa341ada7f140c",
		"1a58be107c3757910721dd6d0f010f921fd9a9c698aedebc945d016f8a2d6837",
		"7e1f4992e3f7a2dfefe27a6ce5f6f0f2f88c183b87dcc951130fdc78350a6f0c",
		"c1d1ea0a367342013cb1d1abeb64a9366054d90d5637b7fadc39287a9a7dba67",
	}

	// Создаем список публичных ключей
	publicKeys := make([]SharedSecretEncryptionPublicKey, len(publicKeyHexes))

	for i, publicKeyHex := range publicKeyHexes {
		publicKeyBytes, err := hex.DecodeString(publicKeyHex)
		if err != nil {
			panic(fmt.Sprintf("Invalid public key hex at index %d: %v", i, err))
		}

		if len(publicKeyBytes) != curve25519.PointSize {
			panic(fmt.Sprintf("Public key at index %d must be %d bytes, got %d", i, curve25519.PointSize, len(publicKeyBytes)))
		}

		copy(publicKeys[i][:], publicKeyBytes)
	}

	// Шифруем общий секрет
	encryptedSecret := EncryptSharedSecret(publicKeys, &sharedSecret, rand.Reader)

	// Выводим результаты
	fmt.Printf("Shared Secret: %x\n", sharedSecret)
	fmt.Printf("Shared Secret Hash: %x\n", encryptedSecret.SharedSecretHash)
	fmt.Printf("Diffie-Hellman Point: %x\n", encryptedSecret.DiffieHellmanPoint)
	fmt.Printf("Number of Encryptions: %d\n", len(encryptedSecret.Encryptions))

	for i, encryption := range encryptedSecret.Encryptions {
		fmt.Printf("Encryption[%d]: %x\n", i, encryption)
	}

	// Структура для ABI кодирования
	fmt.Println("\nFor ABI encoding:")
	fmt.Printf("{\n")
	fmt.Printf("  \"diffieHellmanPoint\": \"0x%x\",\n", encryptedSecret.DiffieHellmanPoint)
	fmt.Printf("  \"sharedSecretHash\": \"0x%x\",\n", encryptedSecret.SharedSecretHash)
	fmt.Printf("  \"encryptions\": [\n")
	for i, encryption := range encryptedSecret.Encryptions {
		if i == len(encryptedSecret.Encryptions)-1 {
			fmt.Printf("    \"0x%x\"\n", encryption)
		} else {
			fmt.Printf("    \"0x%x\",\n", encryption)
		}
	}
	fmt.Printf("  ]\n")
	fmt.Printf("}\n")
}
