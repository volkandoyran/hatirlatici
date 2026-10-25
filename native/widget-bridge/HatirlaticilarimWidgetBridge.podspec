Pod::Spec.new do |spec|
  spec.name = 'HatirlaticilarimWidgetBridge'
  spec.version = '1.0.0'
  spec.summary = 'Hatırlatmalar ile iOS widget uzantısı arasında veri köprüsü.'
  spec.license = { :type => 'MIT' }
  spec.author = 'Hatırlatıcılarım'
  spec.homepage = 'https://capacitorjs.com'
  spec.source = { :path => '.' }
  spec.ios.deployment_target = '16.0'
  spec.swift_version = '5.9'
  spec.source_files = 'ios/Sources/**/*.swift'
  spec.dependency 'Capacitor'
end
