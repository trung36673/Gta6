#!/usr/bin/env bash
# Build APK (cần Node 18+, JDK 17, Android SDK; hoặc dùng GitHub Actions bên dưới)
set -e
cd "$(dirname "$0")"
rm -rf www && mkdir www && cp -r ../index.html ../js ../assets ../sw.js ../manifest.webmanifest ../icon.svg www/
npm install
[ -d android ] || npx cap add android
npx cap sync android
# khoá ngang + toàn màn hình
M=android/app/src/main/AndroidManifest.xml
grep -q screenOrientation $M || sed -i 's/<activity /<activity android:screenOrientation="sensorLandscape" /' $M
sed -i 's#<style name="AppTheme.NoActionBar".*#&#' android/app/src/main/res/values/styles.xml || true
cd android && ./gradlew assembleDebug
echo "APK: android/android/app/build/outputs/apk/debug/app-debug.apk"
