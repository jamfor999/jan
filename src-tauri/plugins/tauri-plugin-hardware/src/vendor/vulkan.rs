use crate::types::GpuInfo;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use {
    crate::types::Vendor,
    vulkano::device::physical::PhysicalDeviceType,
    vulkano::instance::{Instance, InstanceCreateFlags, InstanceCreateInfo, InstanceExtensions},
    vulkano::memory::MemoryHeapFlags,
    vulkano::VulkanLibrary,
};

#[cfg(all(target_os = "macos", not(any(target_os = "android", target_os = "ios"))))]
use vulkano::library::DynamicLibraryLoader;

#[derive(Debug, Clone, serde::Serialize)]
pub struct VulkanInfo {
    pub index: u64,
    pub device_type: String,
    pub api_version: String,
    pub device_id: u32,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn parse_uuid(bytes: &[u8; 16]) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}-\
         {:02x}{:02x}-\
         {:02x}{:02x}-\
         {:02x}{:02x}-\
         {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

/// On macOS, find MoltenVK library path in the app bundle or standard locations
#[cfg(target_os = "macos")]
fn find_moltenvk_library_path() -> Option<std::path::PathBuf> {
    use std::env;
    use std::path::PathBuf;
    
    // First, try the app bundle's Frameworks directory
    if let Ok(exe_path) = env::current_exe() {
        // In a .app bundle: /path/to/Jan.app/Contents/MacOS/Jan
        // Frameworks are at: /path/to/Jan.app/Contents/Frameworks/
        if let Some(macos_dir) = exe_path.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                let frameworks_lib = contents_dir.join("Frameworks").join("libMoltenVK.dylib");
                if frameworks_lib.exists() {
                    log::info!("Found MoltenVK in app bundle: {:?}", frameworks_lib);
                    return Some(frameworks_lib);
                }
            }
        }
    }
    
    // Try common installation paths
    let common_paths = [
        PathBuf::from("/usr/local/lib/libMoltenVK.dylib"),
        PathBuf::from("/opt/homebrew/lib/libMoltenVK.dylib"),
    ];
    
    for path in common_paths {
        if path.exists() {
            log::info!("Found MoltenVK at system path: {:?}", path);
            return Some(path);
        }
    }
    
    log::debug!("MoltenVK not found in app bundle or standard paths");
    None
}

pub fn get_vulkan_gpus() -> Vec<GpuInfo> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        log::info!("Vulkan GPU detection is not supported on mobile platforms");
        vec![]
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        match get_vulkan_gpus_internal() {
            Ok(gpus) => gpus,
            Err(e) => {
                log::error!("Failed to get Vulkan GPUs: {:?}", e);
                vec![]
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_vulkan_gpus_internal() -> Result<Vec<GpuInfo>, Box<dyn std::error::Error>> {
    // On macOS, try to load MoltenVK from the app bundle first
    #[cfg(target_os = "macos")]
    let library = {
        if let Some(moltenvk_path) = find_moltenvk_library_path() {
            // Load from the specific path we found
            let loader = unsafe { DynamicLibraryLoader::new(&moltenvk_path)? };
            VulkanLibrary::with_loader(loader)?
        } else {
            // Fall back to default search paths
            VulkanLibrary::new()?
        }
    };
    
    #[cfg(not(target_os = "macos"))]
    let library = VulkanLibrary::new()?;

    // Check for MoltenVK portability enumeration extension on macOS
    // This is required to enumerate GPUs through MoltenVK's Vulkan-to-Metal translation layer
    #[cfg(target_os = "macos")]
    let (extensions, flags) = {
        let supported_extensions = library.supported_extensions();
        
        // MoltenVK 1.4+ always supports portability enumeration, but may not advertise
        // the extension explicitly. We try to enable it if available, otherwise we still
        // set the ENUMERATE_PORTABILITY flag as MoltenVK requires it.
        let has_portability = supported_extensions.khr_portability_enumeration;
        
        if has_portability {
            log::info!("MoltenVK portability enumeration extension explicitly available");
            (
                InstanceExtensions {
                    khr_portability_enumeration: true,
                    ..Default::default()
                },
                InstanceCreateFlags::ENUMERATE_PORTABILITY,
            )
        } else {
            // Even without the extension explicitly advertised, MoltenVK still requires
            // the ENUMERATE_PORTABILITY flag to enumerate devices properly.
            // We'll try without the extension but with the flag.
            log::info!("MoltenVK detected - enabling portability enumeration flag");
            (
                InstanceExtensions::default(),
                InstanceCreateFlags::ENUMERATE_PORTABILITY,
            )
        }
    };

    #[cfg(not(target_os = "macos"))]
    let (extensions, flags) = (InstanceExtensions::default(), InstanceCreateFlags::empty());

    let instance = Instance::new(
        library,
        InstanceCreateInfo {
            application_name: Some("Jan GPU Detection".into()),
            application_version: vulkano::Version::V1_1,
            enabled_extensions: extensions,
            flags,
            ..Default::default()
        },
    )?;

    let mut device_info_list = vec![];

    let physical_devices: Vec<_> = instance.enumerate_physical_devices()?.collect();
    log::info!("Found {} Vulkan physical devices", physical_devices.len());

    for (i, physical_device) in physical_devices.into_iter().enumerate() {
        let properties = physical_device.properties();
        
        log::info!(
            "Device {}: {} (type: {:?}, vendor: 0x{:04x})",
            i,
            properties.device_name,
            properties.device_type,
            properties.vendor_id
        );

        if properties.device_type == PhysicalDeviceType::Cpu {
            continue;
        }

        let memory_properties = physical_device.memory_properties();
        let total_memory: u64 = memory_properties
            .memory_heaps
            .iter()
            .filter(|heap| heap.flags.intersects(MemoryHeapFlags::DEVICE_LOCAL))
            .map(|heap| heap.size / (1024 * 1024))
            .sum();

        let device_uuid = physical_device.properties().device_uuid.unwrap_or([0; 16]);
        let driver_version = format!("{}", properties.driver_version);

        let device_info = GpuInfo {
            name: properties.device_name.clone(),
            total_memory,
            vendor: Vendor::from_vendor_id(properties.vendor_id),
            uuid: parse_uuid(&device_uuid),
            driver_version,
            nvidia_info: None,
            vulkan_info: Some(VulkanInfo {
                index: i as u64,
                device_type: format!("{:?}", properties.device_type),
                api_version: format!(
                    "{}.{}.{}",
                    properties.api_version.major,
                    properties.api_version.minor,
                    properties.api_version.patch
                ),
                device_id: properties.device_id,
            }),
        };
        device_info_list.push(device_info);
    }

    Ok(device_info_list)
}
