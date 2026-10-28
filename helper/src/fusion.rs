use nalgebra::{UnitQuaternion, Vector3};

/// RUB coordinates: +X right, +Y up, +Z backwards, matching WebXR.
pub struct Fusion {
    pub q: UnitQuaternion<f32>,
    pub bias: Vector3<f32>,
    center: UnitQuaternion<f32>,
    last: Option<u64>,
    samples: u32,
    sum: Vector3<f32>,
    sum_acc: Vector3<f32>,
    calibration_start: Option<u64>,
    pub ready: bool,
}
impl Fusion {
    pub fn new() -> Self {
        Self {
            q: UnitQuaternion::identity(),
            center: UnitQuaternion::identity(),
            bias: Vector3::zeros(),
            last: None,
            samples: 0,
            sum: Vector3::zeros(),
            sum_acc: Vector3::zeros(),
            calibration_start: None,
            ready: false,
        }
    }
    pub fn recenter(&mut self) {
        self.center = self.q.inverse();
    }
    pub fn reset(&mut self) {
        *self = Self::new();
    }
    pub fn output(&self) -> [f32; 4] {
        let q = self.center * self.q;
        [q.i, q.j, q.k, q.w]
    }
    pub fn update(&mut self, acc: Vector3<f32>, gyro: Vector3<f32>, timestamp: u64) {
        if !acc.iter().chain(gyro.iter()).all(|x| x.is_finite()) {
            return;
        }
        let dt = self
            .last
            .and_then(|last| timestamp.checked_sub(last))
            .map(|us| us as f32 / 1_000_000.0);
        self.last = Some(timestamp);
        if !self.ready {
            // Require two continuous seconds approximately stationary. Moving resets the window.
            if gyro.norm() > 0.08 || (acc.norm() - 9.81).abs() > 0.8 {
                self.samples = 0;
                self.sum = Vector3::zeros();
                self.sum_acc = Vector3::zeros();
                self.calibration_start = None;
                return;
            }
            let start = *self.calibration_start.get_or_insert(timestamp);
            if timestamp < start {
                self.reset();
                return;
            }
            self.samples += 1;
            self.sum += gyro;
            self.sum_acc += acc;
            if timestamp - start >= 2_000_000 && self.samples >= 100 {
                self.bias = self.sum / self.samples as f32;
                self.q = UnitQuaternion::rotation_between(&self.sum_acc.normalize(), &Vector3::y())
                    .unwrap_or_default();
                self.recenter();
                self.ready = true;
            }
            return;
        }
        let Some(dt) = dt.filter(|dt| *dt > 0.0 && *dt <= 0.05) else {
            return;
        };
        let mut rate = gyro - self.bias;
        // Gravity corrects roll/pitch slowly. Yaw remains relative; recenter handles drift.
        if (acc.norm() - 9.81).abs() < 1.5 {
            let predicted_up = self.q.inverse_transform_vector(&Vector3::y());
            rate += acc.normalize().cross(&predicted_up) * 0.8;
        }
        self.q *= UnitQuaternion::from_scaled_axis(rate * dt);
        self.q.renormalize();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn calibrated() -> Fusion {
        let mut f = Fusion::new();
        for i in 0..=2100 {
            f.update(Vector3::y() * 9.81, Vector3::new(0.0, 0.01, 0.0), i * 1000);
        }
        assert!(f.ready);
        f
    }
    #[test]
    fn bias_removed_and_yaw_integrates() {
        let mut f = calibrated();
        for i in 2101..=3100 {
            f.update(Vector3::y() * 9.81, Vector3::new(0.0, 0.01, 0.0), i * 1000);
        }
        assert!(f.q.angle() < 0.001);
        for i in 3101..=4100 {
            f.update(Vector3::y() * 9.81, Vector3::new(0.0, 1.01, 0.0), i * 1000);
        }
        assert!((f.q.angle() - 1.0).abs() < 0.002);
        f.recenter();
        assert!(f.output()[0..3].iter().all(|v| v.abs() < 0.0001));
    }
    #[test]
    fn moving_does_not_calibrate() {
        let mut f = Fusion::new();
        for i in 0..4000 {
            f.update(Vector3::y() * 9.81, Vector3::y(), i * 1000);
        }
        assert!(!f.ready);
    }
    #[test]
    fn gaps_and_nonfinite_samples_do_not_corrupt_pose() {
        let mut f = calibrated();
        let before = f.output();
        f.update(Vector3::y() * 9.81, Vector3::y(), 9_000_000);
        f.update(
            Vector3::y() * 9.81,
            Vector3::new(f32::NAN, 0., 0.),
            9_001_000,
        );
        assert_eq!(before, f.output());
    }
    #[test]
    fn gravity_correction_reduces_tilt() {
        let mut f = calibrated();
        f.bias = Vector3::zeros();
        f.q = UnitQuaternion::from_scaled_axis(Vector3::x() * 0.15);
        for i in 2101..=7100 {
            f.update(Vector3::y() * 9.81, Vector3::zeros(), i * 1000);
        }
        assert!(f.q.angle() < 0.01);
    }
}
