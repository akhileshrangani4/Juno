Pod::Spec.new do |s|
  s.name           = 'JunoCamera'
  s.version        = '1.0.0'
  s.summary        = 'Camera preview, capture and on-device Vision framing measurements for Juno'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Juno'
  s.homepage       = 'https://github.com/akhileshrangani4/consumerhack'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/akhileshrangani4/consumerhack.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Vision', 'CoreImage'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
