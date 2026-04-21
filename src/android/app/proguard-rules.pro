# Retrofit
-keepattributes Signature
-keepattributes Annotation
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keep,includedescriptorclasses class com.podcraft.android.**$$serializer { *; }
-keepclassmembers class com.podcraft.android.** {
    *** Companion;
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
