package cz.cointrack.storage

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.model.CreateBucketRequest
import software.amazon.awssdk.services.s3.model.HeadBucketRequest
import software.amazon.awssdk.services.s3.model.NoSuchBucketException
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest
import java.net.URI
import java.time.Duration

data class StorageConfig(
    val endpoint: String,
    val publicEndpoint: String,
    val accessKey: String,
    val secretKey: String,
    val bucket: String,
    val region: String,
)

class StorageService(private val config: StorageConfig) {

    private val credentials = StaticCredentialsProvider.create(
        AwsBasicCredentials.create(config.accessKey, config.secretKey)
    )

    private val s3Config = S3Configuration.builder()
        .pathStyleAccessEnabled(true)   // nutné pro MinIO
        .build()

    private val client: S3Client = S3Client.builder()
        .endpointOverride(URI.create(config.endpoint))
        .credentialsProvider(credentials)
        .region(Region.of(config.region))
        .serviceConfiguration(s3Config)
        .httpClient(UrlConnectionHttpClient.builder().build())
        .build()

    private val presigner: S3Presigner = S3Presigner.builder()
        .endpointOverride(URI.create(config.publicEndpoint))
        .credentialsProvider(credentials)
        .region(Region.of(config.region))
        .serviceConfiguration(s3Config)
        .build()

    init {
        ensureBucketExists()
    }

    private fun ensureBucketExists() {
        try {
            client.headBucket(HeadBucketRequest.builder().bucket(config.bucket).build())
        } catch (_: NoSuchBucketException) {
            client.createBucket(CreateBucketRequest.builder().bucket(config.bucket).build())
        } catch (_: Exception) {
            // Bucket buď existuje, nebo MinIO ještě neběží. Init poběží po restartu.
        }
    }

    /**
     * Presigned URL pro upload. Klient pošle PUT na tuto URL s content-type headerem.
     */
    fun presignUpload(storageKey: String, contentType: String, ttl: Duration = Duration.ofMinutes(15)): String {
        val putRequest = software.amazon.awssdk.services.s3.model.PutObjectRequest.builder()
            .bucket(config.bucket)
            .key(storageKey)
            .contentType(contentType)
            .build()

        val presignRequest = PutObjectPresignRequest.builder()
            .signatureDuration(ttl)
            .putObjectRequest(putRequest)
            .build()

        return presigner.presignPutObject(presignRequest).url().toString()
    }

    /**
     * Presigned URL pro download. Platí 5 minut.
     */
    fun presignDownload(storageKey: String, ttl: Duration = Duration.ofMinutes(5)): String {
        val getRequest = software.amazon.awssdk.services.s3.model.GetObjectRequest.builder()
            .bucket(config.bucket)
            .key(storageKey)
            .build()

        val presignRequest = GetObjectPresignRequest.builder()
            .signatureDuration(ttl)
            .getObjectRequest(getRequest)
            .build()

        return presigner.presignGetObject(presignRequest).url().toString()
    }

    fun bucket(): String = config.bucket

    /**
     * Server-side přímý upload binárních dat do S3/MinIO. Vrací storage key.
     * Používá se z workerů (např. EmailInboxWorker) které běží na serveru
     * a nepotřebují presigned URL.
     */
    fun uploadDirectly(bytes: ByteArray, contentType: String, purpose: String): String {
        val ext = when {
            contentType.contains("pdf") -> "pdf"
            contentType.contains("png") -> "png"
            contentType.contains("jpeg") || contentType.contains("jpg") -> "jpg"
            contentType.contains("webp") -> "webp"
            contentType.contains("heic") -> "heic"
            else -> "bin"
        }
        val key = "$purpose/${java.util.UUID.randomUUID()}.$ext"
        client.putObject(
            software.amazon.awssdk.services.s3.model.PutObjectRequest.builder()
                .bucket(config.bucket)
                .key(key)
                .contentType(contentType)
                .build(),
            software.amazon.awssdk.core.sync.RequestBody.fromBytes(bytes),
        )
        return key
    }
}
